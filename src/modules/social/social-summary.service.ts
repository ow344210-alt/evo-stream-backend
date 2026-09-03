import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';

/**
 * Aggregate social summary for a video: like/comment/share counts plus, when
 * a viewer is authenticated, their personal state (isLiked, isSaved, and
 * whether they follow the video's channel).
 */
@Injectable()
export class SocialSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: VideoPlaybackService,
  ) {}

  async getSummary(videoId: string, userId?: string) {
    const video = await this.playback.assertEligible(videoId);

    const [likeCount, commentCount, shareCount, followerCount, likeRow, savedRow, followRow] =
      await Promise.all([
        this.prisma.videoLike.count({ where: { videoId } }),
        this.prisma.comment.count({ where: { videoId } }),
        this.prisma.videoShare.count({ where: { videoId } }),
        this.prisma.channelFollow.count({ where: { channelId: video.channelId } }),
        userId
          ? this.prisma.videoLike.findUnique({
              where: { userId_videoId: { userId, videoId } },
            })
          : Promise.resolve(null),
        userId
          ? this.prisma.savedVideo.findUnique({
              where: { userId_videoId: { userId, videoId } },
            })
          : Promise.resolve(null),
        userId
          ? this.prisma.channelFollow.findUnique({
              where: {
                userId_channelId: { userId, channelId: video.channelId },
              },
            })
          : Promise.resolve(null),
      ]);

    return {
      videoId,
      likeCount,
      commentCount,
      shareCount,
      channelFollowerCount: followerCount,
      isLiked: Boolean(userId && likeRow),
      isSaved: Boolean(userId && savedRow),
      isFollowing: Boolean(userId && followRow),
    };
  }
}
