import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Save/unsave videos to a viewer's library. One save per (user, video) enforced
 * by a compound unique constraint. Only eligible (READY + PUBLISHED) videos can
 * be saved.
 */
@Injectable()
export class SavedVideosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: VideoPlaybackService,
  ) {}

  async save(userId: string, videoId: string) {
    await this.playback.assertEligible(videoId);

    const existing = await this.prisma.savedVideo.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });
    if (!existing) {
      await this.prisma.savedVideo.create({ data: { userId, videoId } });
    }
    return { saved: true };
  }

  async unsave(userId: string, videoId: string) {
    await this.playback.assertEligible(videoId);

    const existing = await this.prisma.savedVideo.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });
    if (existing) {
      await this.prisma.savedVideo.delete({ where: { id: existing.id } });
    }
    return { saved: false };
  }

  async getSavedVideos(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.savedVideo.findMany({
        where,
        include: {
          video: {
            include: {
              channel: { select: { id: true, name: true, slug: true } },
              category: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: { savedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.savedVideo.count({ where }),
    ]);

    return {
      items: rows.map((row) => row.video),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
