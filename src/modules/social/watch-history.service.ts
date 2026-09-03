import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { RecordProgressDto } from './dto/record-progress.dto';

/**
 * Per-viewer watch progress history. One row per (user, video), upserted on
 * each progress report so the list stays de-duplicated with the latest
 * position. Only eligible (READY + PUBLISHED) videos can be recorded.
 */
@Injectable()
export class WatchHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: VideoPlaybackService,
  ) {}

  async recordProgress(userId: string, videoId: string, dto: RecordProgressDto) {
    await this.playback.assertEligible(videoId);

    const positionSeconds =
      typeof dto.positionSeconds === 'number' && dto.positionSeconds > 0
        ? dto.positionSeconds
        : 0;
    const progressPercent =
      dto.progressPercent !== undefined
        ? Math.min(Math.max(dto.progressPercent, 0), 100)
        : 0;

    return this.prisma.watchHistory.upsert({
      where: { userId_videoId: { userId, videoId } },
      create: {
        userId,
        videoId,
        positionSeconds,
        progressPercent,
        watchedAt: new Date(),
      },
      update: {
        positionSeconds,
        progressPercent,
        watchedAt: new Date(),
      },
      include: { video: { select: { id: true, title: true } } },
    });
  }

  async getHistory(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.watchHistory.findMany({
        where,
        include: {
          video: {
            include: {
              channel: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: { watchedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.watchHistory.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        positionSeconds: row.positionSeconds,
        progressPercent: row.progressPercent,
        watchedAt: row.watchedAt,
        video: row.video,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async removeHistoryItem(userId: string, videoId: string) {
    const existing = await this.prisma.watchHistory.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });
    if (existing) {
      await this.prisma.watchHistory.delete({ where: { id: existing.id } });
    }
    return { message: 'History item removed' };
  }
}
