import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments.query';

/**
 * Comments and replies on videos. Authoring requires an authenticated user and
 * an eligible (READY + PUBLISHED) video. Only the comment owner may edit or
 * delete their comment.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: VideoPlaybackService,
  ) {}

  async create(userId: string, videoId: string, dto: CreateCommentDto) {
    await this.playback.assertEligible(videoId);

    if (dto.parentId) {
      const parent = await this.prisma.comment.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new BadRequestException('Parent comment not found');
      }
      if (parent.videoId !== videoId) {
        throw new BadRequestException('Reply belongs to a different video');
      }
      if (parent.parentId) {
        throw new BadRequestException('Cannot reply to a reply');
      }
    }

    return this.prisma.comment.create({
      data: {
        content: dto.content.trim(),
        userId,
        videoId,
        parentId: dto.parentId,
      },
      include: {
        user: { select: { id: true, name: true } },
        _count: { select: { replies: true } },
      },
    });
  }

  async list(videoId: string, query: ListCommentsQueryDto) {
    await this.playback.assertEligible(videoId);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: any = { videoId };
    if (query.parentId) {
      where.parentId = query.parentId;
    } else {
      where.parentId = null;
    }

    const [items, total] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        include: {
          user: { select: { id: true, name: true } },
          _count: { select: { replies: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.comment.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async update(userId: string, commentId: string, dto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    this.assertOwner(comment.userId, userId);

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content: dto.content.trim() },
      include: {
        user: { select: { id: true, name: true } },
        _count: { select: { replies: true } },
      },
    });
  }

  async remove(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    this.assertOwner(comment.userId, userId);

    // Deleting a parent cascades to its replies (Prisma onDelete: Cascade).
    await this.prisma.comment.delete({ where: { id: commentId } });
    return { message: 'Comment deleted' };
  }

  private assertOwner(ownerId: string, userId: string) {
    if (ownerId !== userId) {
      throw new ForbiddenException('You can only manage your own comments');
    }
  }
}
