import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessingStatus, VideoStatus } from '@prisma/client';

export interface CreatorDashboardStats {
  totalVideos: number;
  draftCount: number;
  publishedCount: number;
  hiddenCount: number;
  processingCount: number;
  followersCount: number;
}

export interface CreatorDashboardVideo {
  id: string;
  title: string;
  status: VideoStatus;
  processingStatus: VideoProcessingStatus | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  createdAt: Date;
  publishedAt: Date | null;
  category: { id: string; name: string; slug: string } | null;
}

export interface CreatorDashboardData {
  user: { id: string; name: string; email: string };
  profile: { id: string; bio: string | null; isVerified: boolean };
  channel: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
    websiteUrl: string | null;
    instagramUrl: string | null;
    youtubeUrl: string | null;
    twitterUrl: string | null;
    isSuspended: boolean;
    category: { id: string; name: string; slug: string } | null;
  } | null;
  stats: CreatorDashboardStats;
  recentVideos: CreatorDashboardVideo[];
}

@Injectable()
export class CreatorDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Return the current creator's dashboard, scoped to the authenticated user. */
  async getDashboard(userId: string): Promise<CreatorDashboardData> {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        channel: { include: { category: { select: { id: true, name: true, slug: true } } } },
      },
    });

    if (!profile) {
      // A JWT-authenticated CREATOR should always have a creator profile;
      // guard defensively if the invariant is somehow violated.
      throw new NotFoundException('Creator profile not found');
    }

    const channel = profile.channel;

    if (!channel) {
      return {
        user: profile.user,
        profile: { id: profile.id, bio: profile.bio, isVerified: profile.isVerified },
        channel: null,
        stats: {
          totalVideos: 0,
          draftCount: 0,
          publishedCount: 0,
          hiddenCount: 0,
          processingCount: 0,
          followersCount: 0,
        },
        recentVideos: [],
      };
    }

    // Aggregate video counts by status and processing status, plus channel
    // follower count. All queries are scoped to this creator's channel.
    const [statusGroups, processingCount, followerCount, recentVideos] = await Promise.all([
      this.prisma.video.groupBy({
        by: ['status'],
        where: { channelId: channel.id },
        _count: { _all: true },
      }),
      this.prisma.video.count({
        where: {
          channelId: channel.id,
          processingStatus: { in: [VideoProcessingStatus.UPLOADED, VideoProcessingStatus.PROCESSING] },
        },
      }),
      this.prisma.channelFollow.count({ where: { channelId: channel.id } }),
      this.prisma.video.findMany({
        where: { channelId: channel.id },
        select: {
          id: true,
          title: true,
          status: true,
          processingStatus: true,
          thumbnailUrl: true,
          durationSeconds: true,
          createdAt: true,
          publishedAt: true,
          category: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const toCount = (s: VideoStatus) => {
      const row = statusGroups.find((g) => g.status === s);
      return row?._count._all ?? 0;
    };

    return {
      user: profile.user,
      profile: { id: profile.id, bio: profile.bio, isVerified: profile.isVerified },
      channel: channel
        ? {
            id: channel.id,
            name: channel.name,
            slug: channel.slug,
            description: channel.description,
            logoUrl: channel.logoUrl,
            bannerUrl: channel.bannerUrl,
            websiteUrl: channel.websiteUrl,
            instagramUrl: channel.instagramUrl,
            youtubeUrl: channel.youtubeUrl,
            twitterUrl: channel.twitterUrl,
            isSuspended: channel.isSuspended,
            category: channel.category,
          }
        : null,
      stats: {
        totalVideos:
          toCount(VideoStatus.DRAFT) +
          toCount(VideoStatus.PUBLISHED) +
          toCount(VideoStatus.HIDDEN),
        draftCount: toCount(VideoStatus.DRAFT),
        publishedCount: toCount(VideoStatus.PUBLISHED),
        hiddenCount: toCount(VideoStatus.HIDDEN),
        processingCount,
        followersCount: followerCount,
      },
      recentVideos,
    };
  }
}
