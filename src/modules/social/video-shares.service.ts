import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';

/**
 * Records a share of a video. Each share action appends a row so share counts
 * accumulate over time. Only eligible (READY + PUBLISHED) videos can be shared.
 * The sharer is derived from the authenticated request, never from the body.
 */
@Injectable()
export class VideoSharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: VideoPlaybackService,
  ) {}

  async share(userId: string, videoId: string) {
    await this.playback.assertEligible(videoId);

    await this.prisma.videoShare.create({
      data: { userId, videoId },
    });

    const shareCount = await this.prisma.videoShare.count({ where: { videoId } });
    return { shared: true, shareCount };
  }
}
