import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AnalyticsVideoRow {
  id: string;
  title: string;
  status: string;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement: number; // likes + comments + shares + saves
}

export interface TimeSeriesBucket {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface CreatorAnalyticsData {
  // ---- Real Qualified View Metrics ----
  totalViews: number;
  viewsLast30Days: TimeSeriesBucket[];
  trackingSince: string; // ISO timestamp of telemetry epoch

  // ---- Channel engagement totals & Retained Followers ----
  followersCount: number;
  newFollowersLast30Days: number;
  prevPeriodFollowers: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  /** Engagement ratio as percentage: (Likes + Comments + Shares + Saves) / totalViews */
  engagementRatio: number;

  /** Distinct (userId, videoId) rows in WatchHistory. Label as "saved watch sessions". */
  savedWatchSessions: number;
  /** Average of WatchHistory.progressPercent. */
  avgSavedProgressPct: number | null;

  // ---- Video counts ----
  totalVideos: number;
  publishedCount: number;
  draftCount: number;
  hiddenCount: number;

  /** Sum of durationSeconds for all PUBLISHED videos, converted to hours. */
  publishedContentHours: number;

  // ---- Top videos by views / engagement ----
  topVideos: AnalyticsVideoRow[];

  // ---- Time-series: last 30 days ----
  likesLast30Days: TimeSeriesBucket[];
  followsLast30Days: TimeSeriesBucket[];
  commentsLast30Days: TimeSeriesBucket[];
  sharesLast30Days: TimeSeriesBucket[];

  // ---- Recently published videos ----
  recentlyPublished: {
    id: string;
    title: string;
    thumbnailUrl: string | null;
    publishedAt: string | null;
    durationSeconds: number | null;
  }[];
}

const TELEMETRY_EPOCH_ISO = '2026-09-24T00:00:00.000Z';

/** Group an array of Date values into YYYY-MM-DD buckets within [from, to]. */
function buildTimeSeries(dates: Date[], from: Date, to: Date): TimeSeriesBucket[] {
  const counts: Record<string, number> = {};

  // Pre-fill every day in the window with 0 so the series is dense.
  const cursor = new Date(from);
  while (cursor <= to) {
    counts[cursor.toISOString().slice(0, 10)] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    if (key in counts) {
      counts[key]++;
    }
  }

  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

@Injectable()
export class CreatorAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnalytics(userId: string): Promise<CreatorAnalyticsData> {
    // --- Resolve the creator's channel id from the authenticated user ---
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      include: { channel: { select: { id: true } } },
    });

    if (!profile) {
      throw new NotFoundException('Creator profile not found');
    }

    if (!profile.channel) {
      return this.zeroState();
    }

    const channelId = profile.channel.id;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // --- Fetch all video IDs for this channel ---
    const channelVideos = await this.prisma.video.findMany({
      where: { channelId },
      select: {
        id: true,
        title: true,
        status: true,
        thumbnailUrl: true,
        publishedAt: true,
        durationSeconds: true,
      },
    });

    const videoIds = channelVideos.map((v) => v.id);

    if (videoIds.length === 0) {
      const [followersCount, newFollowersLast30Days, prevPeriodFollowers] = await Promise.all([
        this.prisma.channelFollow.count({ where: { channelId } }),
        this.prisma.channelFollow.count({
          where: { channelId, followedAt: { gte: thirtyDaysAgo } },
        }),
        this.prisma.channelFollow.count({
          where: { channelId, followedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
        }),
      ]);
      return {
        ...this.zeroState(),
        followersCount,
        newFollowersLast30Days,
        prevPeriodFollowers,
      };
    }

    // --- Aggregate social and view counts for this channel's videos ---
    const [
      followersCount,
      newFollowersLast30Days,
      prevPeriodFollowers,
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      totalSaves,
      savedWatchSessions,
      videoCountsByStatus,
      publishedDurationAgg,
    ] = await Promise.all([
      // Current Followers
      this.prisma.channelFollow.count({ where: { channelId } }),

      // New followers retained in last 30 days
      this.prisma.channelFollow.count({
        where: { channelId, followedAt: { gte: thirtyDaysAgo } },
      }),

      // Previous 30-day period followers
      this.prisma.channelFollow.count({
        where: { channelId, followedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),

      // Real Qualified Video Views
      this.prisma.videoView.count({ where: { videoId: { in: videoIds } } }),

      // Total likes across all videos
      this.prisma.videoLike.count({ where: { videoId: { in: videoIds } } }),

      // Total comments across all videos
      this.prisma.comment.count({ where: { videoId: { in: videoIds } } }),

      // Total shares across all videos
      this.prisma.videoShare.count({ where: { videoId: { in: videoIds } } }),

      // Total saves across all videos
      this.prisma.savedVideo.count({ where: { videoId: { in: videoIds } } }),

      // Distinct saved watch sessions in WatchHistory
      this.prisma.watchHistory.count({ where: { videoId: { in: videoIds } } }),

      // Video counts by status
      this.prisma.video.groupBy({
        by: ['status'],
        where: { channelId },
        _count: { _all: true },
      }),

      // Sum of duration for PUBLISHED videos
      this.prisma.video.aggregate({
        where: { channelId, status: 'PUBLISHED' },
        _sum: { durationSeconds: true },
      }),
    ]);

    // Average saved progress
    const avgProgressResult = await this.prisma.watchHistory.aggregate({
      where: { videoId: { in: videoIds } },
      _avg: { progressPercent: true },
    });

    const avgSavedProgressPct =
      avgProgressResult._avg.progressPercent !== null
        ? Math.min(100, Math.max(0, avgProgressResult._avg.progressPercent))
        : null;

    // Status breakdown
    const countByStatus = (s: string) => {
      const row = videoCountsByStatus.find((g) => g.status === s);
      return row?._count._all ?? 0;
    };

    const publishedContentHours =
      (publishedDurationAgg._sum.durationSeconds ?? 0) / 3600;

    // --- Per-video counts for top-video ranking ---
    const [viewsPerVideo, likesPerVideo, commentsPerVideo, sharesPerVideo, savesPerVideo] =
      await Promise.all([
        this.prisma.videoView.groupBy({
          by: ['videoId'],
          where: { videoId: { in: videoIds } },
          _count: { _all: true },
        }),
        this.prisma.videoLike.groupBy({
          by: ['videoId'],
          where: { videoId: { in: videoIds } },
          _count: { _all: true },
        }),
        this.prisma.comment.groupBy({
          by: ['videoId'],
          where: { videoId: { in: videoIds } },
          _count: { _all: true },
        }),
        this.prisma.videoShare.groupBy({
          by: ['videoId'],
          where: { videoId: { in: videoIds } },
          _count: { _all: true },
        }),
        this.prisma.savedVideo.groupBy({
          by: ['videoId'],
          where: { videoId: { in: videoIds } },
          _count: { _all: true },
        }),
      ]);

    const viewMap = Object.fromEntries(viewsPerVideo.map((r) => [r.videoId, r._count._all]));
    const likeMap = Object.fromEntries(likesPerVideo.map((r) => [r.videoId, r._count._all]));
    const commentMap = Object.fromEntries(commentsPerVideo.map((r) => [r.videoId, r._count._all]));
    const shareMap = Object.fromEntries(sharesPerVideo.map((r) => [r.videoId, r._count._all]));
    const saveMap = Object.fromEntries(savesPerVideo.map((r) => [r.videoId, r._count._all]));

    const topVideos: AnalyticsVideoRow[] = channelVideos
      .map((v) => {
        const views = viewMap[v.id] ?? 0;
        const likes = likeMap[v.id] ?? 0;
        const comments = commentMap[v.id] ?? 0;
        const shares = shareMap[v.id] ?? 0;
        const saves = saveMap[v.id] ?? 0;
        const engagement = likes + comments + shares + saves;
        return {
          id: v.id,
          title: v.title,
          status: v.status,
          thumbnailUrl: v.thumbnailUrl,
          publishedAt: v.publishedAt,
          durationSeconds: v.durationSeconds,
          views,
          likes,
          comments,
          shares,
          saves,
          engagement,
        };
      })
      .sort((a, b) => b.views - a.views || b.engagement - a.engagement)
      .slice(0, 5);

    // --- Time-series: last 30 days ---
    const [viewsDates, likesDates, followsDates, commentsDates, sharesDates] = await Promise.all([
      this.prisma.videoView
        .findMany({
          where: { videoId: { in: videoIds }, viewedAt: { gte: thirtyDaysAgo } },
          select: { viewedAt: true },
        })
        .then((rows) => rows.map((r) => r.viewedAt)),

      this.prisma.videoLike
        .findMany({
          where: { videoId: { in: videoIds }, createdAt: { gte: thirtyDaysAgo } },
          select: { createdAt: true },
        })
        .then((rows) => rows.map((r) => r.createdAt)),

      this.prisma.channelFollow
        .findMany({
          where: { channelId, followedAt: { gte: thirtyDaysAgo } },
          select: { followedAt: true },
        })
        .then((rows) => rows.map((r) => r.followedAt)),

      this.prisma.comment
        .findMany({
          where: { videoId: { in: videoIds }, createdAt: { gte: thirtyDaysAgo } },
          select: { createdAt: true },
        })
        .then((rows) => rows.map((r) => r.createdAt)),

      this.prisma.videoShare
        .findMany({
          where: { videoId: { in: videoIds }, createdAt: { gte: thirtyDaysAgo } },
          select: { createdAt: true },
        })
        .then((rows) => rows.map((r) => r.createdAt)),
    ]);

    // Engagement Ratio: total interactions / total qualified views
    const totalInteractions = totalLikes + totalComments + totalShares + totalSaves;
    const engagementRatio =
      totalViews > 0
        ? Math.round((totalInteractions / totalViews) * 1000) / 10
        : totalInteractions > 0
          ? 100.0
          : 0.0;

    // --- Recently published (last 5 by publishedAt desc) ---
    const recentlyPublished = await this.prisma.video.findMany({
      where: { channelId, status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
        publishedAt: true,
        durationSeconds: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    });

    return {
      totalViews,
      viewsLast30Days: buildTimeSeries(viewsDates, thirtyDaysAgo, now),
      trackingSince: TELEMETRY_EPOCH_ISO,
      followersCount,
      newFollowersLast30Days,
      prevPeriodFollowers,
      totalLikes,
      totalComments,
      totalShares,
      totalSaves,
      engagementRatio,
      savedWatchSessions,
      avgSavedProgressPct,
      totalVideos: channelVideos.length,
      publishedCount: countByStatus('PUBLISHED'),
      draftCount: countByStatus('DRAFT'),
      hiddenCount: countByStatus('HIDDEN'),
      publishedContentHours: Math.round(publishedContentHours * 10) / 10,
      topVideos,
      likesLast30Days: buildTimeSeries(likesDates, thirtyDaysAgo, now),
      followsLast30Days: buildTimeSeries(followsDates, thirtyDaysAgo, now),
      commentsLast30Days: buildTimeSeries(commentsDates, thirtyDaysAgo, now),
      sharesLast30Days: buildTimeSeries(sharesDates, thirtyDaysAgo, now),
      recentlyPublished: recentlyPublished.map((v) => ({
        id: v.id,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
        durationSeconds: v.durationSeconds,
      })),
    };
  }

  private zeroState(): CreatorAnalyticsData {
    return {
      totalViews: 0,
      viewsLast30Days: [],
      trackingSince: TELEMETRY_EPOCH_ISO,
      followersCount: 0,
      newFollowersLast30Days: 0,
      prevPeriodFollowers: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalSaves: 0,
      engagementRatio: 0,
      savedWatchSessions: 0,
      avgSavedProgressPct: null,
      totalVideos: 0,
      publishedCount: 0,
      draftCount: 0,
      hiddenCount: 0,
      publishedContentHours: 0,
      topVideos: [],
      likesLast30Days: [],
      followsLast30Days: [],
      commentsLast30Days: [],
      sharesLast30Days: [],
      recentlyPublished: [],
    };
  }
}
