import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Video like/unlike. Like is a single toggle per (user, video) enforced by a
 * compound unique constraint. Eligibility (READY + PUBLISHED) is delegated to
 * VideoPlaybackService so social and playback never diverge.
 */
@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: VideoPlaybackService,
  ) {}

  async like(userId: string, videoId: string) {
    await this.playback.assertEligible(videoId);

    const existing = await this.prisma.videoLike.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });
    if (!existing) {
      await this.prisma.videoLike.create({ data: { userId, videoId } });
    }

    const likeCount = await this.prisma.videoLike.count({ where: { videoId } });
    return { liked: true, likeCount };
  }

  async unlike(userId: string, videoId: string) {
    await this.playback.assertEligible(videoId);

    const existing = await this.prisma.videoLike.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });
    if (existing) {
      await this.prisma.videoLike.delete({ where: { id: existing.id } });
    }

    const likeCount = await this.prisma.videoLike.count({ where: { videoId } });
    return { liked: false, likeCount };
  }

  async getLikedVideos(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.videoLike.findMany({
        where,
        include: {
          video: {
            include: {
              channel: { select: { id: true, name: true, slug: true } },
              category: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.videoLike.count({ where }),
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
