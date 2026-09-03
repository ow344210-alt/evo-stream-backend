import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  VIDEO_STORAGE_PROVIDER,
  type VideoStorageProvider,
  type VideoStorageStoreInput,
} from '../video-storage/video-storage.types';
import { VideoUploadPolicy } from '../video-storage/video-storage.config';
import { sanitiseObjectSegment } from '../video-storage/storage-path.util';
import { VideoProcessingQueue } from '../video-processing/video-processing.queue';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { UploadVideoDto } from './dto/upload-video.dto';

/** Minimal, provider-agnostic representation of an uploaded source file. */
export interface UploadSourceFile {
  /** Original client filename (untrusted; used as metadata only). */
  originalName: string;
  /** Declared media type / MIME. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /** File bytes. */
  buffer: Buffer | null;
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VIDEO_STORAGE_PROVIDER) private readonly storage: VideoStorageProvider,
    private readonly policy: VideoUploadPolicy,
    private readonly processingQueue: VideoProcessingQueue,
  ) {}

  // Resolve the creator's own channel id from the authenticated user.
  private async getOwnChannelId(userId: string): Promise<string> {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      include: { channel: { select: { id: true } } },
    });
    if (!profile?.channel) {
      throw new BadRequestException('Create a channel before uploading videos');
    }
    return profile.channel.id;
  }

  private async assertCategoryExists(categoryId?: string) {
    if (!categoryId) return;
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new BadRequestException('Selected category does not exist');
    }
  }

  private async findOwnVideo(userId: string, videoId: string) {
    const channelId = await this.getOwnChannelId(userId);
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, channelId },
      include: { category: true, channel: { select: { id: true, name: true, slug: true } } },
    });
    if (!video) {
      throw new NotFoundException('Video not found');
    }
    return video;
  }

  // ---- Creator endpoints ----

  async createOwn(userId: string, dto: CreateVideoDto) {
    const channelId = await this.getOwnChannelId(userId);
    await this.assertCategoryExists(dto.categoryId);
    const status = dto.status ?? VideoStatus.DRAFT;
    const publishedAt =
      status === VideoStatus.PUBLISHED ? (dto.publishedAt ? new Date(dto.publishedAt) : new Date()) : null;
    return this.prisma.video.create({
      data: {
        channelId,
        title: dto.title.trim(),
        description: dto.description,
        thumbnailUrl: dto.thumbnailUrl,
        categoryId: dto.categoryId,
        status,
        publishedAt,
      },
      include: { category: true },
    });
  }

  async listOwn(userId: string, status?: VideoStatus) {
    const channelId = await this.getOwnChannelId(userId);
    const where: any = { channelId };
    if (status) where.status = status;
    const items = await this.prisma.video.findMany({
      where,
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async getOwn(userId: string, videoId: string) {
    return this.findOwnVideo(userId, videoId);
  }

  async updateOwn(userId: string, videoId: string, dto: UpdateVideoDto) {
    const video = await this.findOwnVideo(userId, videoId);
    await this.assertCategoryExists(dto.categoryId);
    const data: any = { ...dto };
    if (dto.title) data.title = dto.title.trim();
    if (dto.status === VideoStatus.PUBLISHED) {
      data.publishedAt = video.publishedAt ?? new Date();
    }
    return this.prisma.video.update({
      where: { id: video.id },
      data,
      include: { category: true },
    });
  }

  /**
   * Upload a real source file to an existing creator-owned video.
   *
   * Flow (ordered for failure safety):
   *   1. Ownership: creator must own the target video via their channel.
   *   2. Validate optional metadata (category exists).
   *   3. Validate exactly-one file, MIME and size via VideoUploadPolicy.
   *   4. Apply optional metadata edits.
   *   5. Store the source object under `videos/{videoId}/source/{safe name}`.
   *   6. Persist the storage/provider identity. If this DB update fails after
   *      the file was stored, delete the stored object to avoid an orphan.
   */
  async uploadSource(
    userId: string,
    videoId: string,
    file: UploadSourceFile | null,
    dto: UploadVideoDto = {},
  ): Promise<{ id: string; [key: string]: unknown }> {
    if (!file) {
      throw new BadRequestException('A video file is required for upload');
    }

    // Ownership: creator must own the target video via their channel.
    const video = await this.findOwnVideo(userId, videoId);

    // Optional metadata validation.
    if (dto.categoryId) await this.assertCategoryExists(dto.categoryId);

    // File validation (size + MIME). We never trust extension alone.
    try {
      this.policy.validate(file.size, file.mimeType);
    } catch (validationError) {
      if (validationError instanceof BadRequestException) throw validationError;
      throw new BadRequestException(
        validationError instanceof Error ? validationError.message : 'Invalid video file',
      );
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty');
    }
    if (file.buffer.length > this.policy.maxBytes) {
      throw new BadRequestException(
        `Upload exceeds configured limit of ${this.policy.maxBytes} bytes`,
      );
    }

    // Apply optional metadata edits without touching existing source fields.
    const metadataData: any = {};
    if (dto.title !== undefined) metadataData.title = dto.title.trim();
    if (dto.description !== undefined) metadataData.description = dto.description;
    if (dto.thumbnailUrl !== undefined) metadataData.thumbnailUrl = dto.thumbnailUrl;
    if (dto.categoryId !== undefined) metadataData.categoryId = dto.categoryId;
    if (dto.status === VideoStatus.PUBLISHED) {
      metadataData.status = VideoStatus.PUBLISHED;
      metadataData.publishedAt = video.publishedAt ?? new Date();
    }
    if (Object.keys(metadataData).length > 0) {
      await this.prisma.video.update({ where: { id: video.id }, data: metadataData });
    }

    // Safe, stable object path associated with this video id. Client filename
    // is sanitised and used for metadata only.
    const safeName = sanitiseObjectSegment(file.originalName, 'source.mp4');
    const objectPath = `videos/${video.id}/source/${safeName}`;

    const storeInput: VideoStorageStoreInput = {
      buffer: file.buffer,
      objectPath,
      originalName: file.originalName,
      mimeType: file.mimeType,
    };

    let stored: Awaited<ReturnType<VideoStorageProvider['store']>>;
    try {
      stored = await this.storage.store(storeInput);
    } catch (error) {
      this.logger.error(
        `Video source storage failed for ${video.id}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException('Failed to store the video file. Please try again.');
    }

    // Persist storage/provider identity. Clean up the stored object on failure.
    try {
      const updated = await this.prisma.video.update({
        where: { id: video.id },
        data: {
          sourceStorageProvider: stored.provider,
          sourceStorageKey: stored.key,
          sourceOriginalName: file.originalName,
          sourceMimeType: file.mimeType,
          sourceFileSize: stored.sizeBytes ?? file.buffer.length,
          processingStatus: VideoProcessingStatus.UPLOADED,
        },
        include: { category: true },
      });

      // Queue the FFMpeg processing (UPLOADED -> PROCESSING -> READY/FAILED)
      // asynchronously so the upload response is not blocked by transcoding.
      this.processingQueue.enqueue(video.id);
      return updated;
    } catch (error) {
      // Avoid leaving an orphaned stored source file when DB persistence fails.
      try {
        await this.storage.delete(stored.key);
      } catch (cleanupError) {
        this.logger.error(
          `Failed to clean up stored source ${stored.key} after DB error`,
          cleanupError instanceof Error ? cleanupError.stack : undefined,
        );
      }
      this.logger.error(`Video source metadata persistence failed for ${video.id}`);
      throw error;
    }
  }

  async removeOwn(userId: string, videoId: string) {
    const video = await this.findOwnVideo(userId, videoId);
    await this.prisma.video.delete({ where: { id: video.id } });

    // After a successful destructive delete, best-effort clean up the stored
    // source object. Deleting a missing object is a defined no-op.
    if (video.sourceStorageKey) {
      try {
        await this.storage.delete(video.sourceStorageKey);
      } catch (error) {
        this.logger.error(
          `Failed to delete stored source ${video.sourceStorageKey}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return { message: 'Video deleted' };
  }

  // ---- Admin endpoints ----

  async adminFindAll(query: PaginationQueryDto, status?: VideoStatus) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { channel: { name: { contains: search, mode: 'insensitive' } } },
        { category: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.video.findMany({
        where,
        include: {
          category: true,
          channel: { include: { creator: { include: { user: { select: { id: true, name: true, email: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.video.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async adminFindOne(id: string) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: {
        category: true,
        channel: { include: { creator: { include: { user: { select: { id: true, name: true, email: true } } } } } },
      },
    });
    if (!video) {
      throw new NotFoundException('Video not found');
    }
    return video;
  }

  async adminUpdateStatus(id: string, status: VideoStatus) {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) {
      throw new NotFoundException('Video not found');
    }
    return this.prisma.video.update({
      where: { id },
      data: { status, publishedAt: status === VideoStatus.PUBLISHED && !video.publishedAt ? new Date() : video.publishedAt },
      include: { category: true },
    });
  }
}