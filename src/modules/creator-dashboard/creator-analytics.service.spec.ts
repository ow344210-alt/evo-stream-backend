import { NotFoundException } from '@nestjs/common';
import { CreatorAnalyticsService } from './creator-analytics.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CreatorAnalyticsService', () => {
  let service: CreatorAnalyticsService;
  let prisma: any;

  const baseProfile = {
    id: 'profile-1',
    userId: 'u1',
    channel: {
      id: 'chan-1',
      name: 'Ada Studio',
    },
  };

  beforeEach(() => {
    prisma = {
      creatorProfile: { findUnique: jest.fn() },
      video: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
      videoView: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      channelFollow: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      videoLike: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      comment: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      videoShare: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      savedVideo: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      watchHistory: {
        count: jest.fn(),
        aggregate: jest.fn(),
      },
    };

    service = new CreatorAnalyticsService(prisma as PrismaService);
  });

  it('throws NotFoundException when creator profile does not exist', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue(null);
    await expect(service.getAnalytics('nonexistent-user')).rejects.toThrow(NotFoundException);
  });

  it('returns zero state when creator has no channel yet', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      channel: null,
    });

    const result = await service.getAnalytics('u1');

    expect(result.totalViews).toBe(0);
    expect(result.followersCount).toBe(0);
    expect(result.totalLikes).toBe(0);
    expect(result.engagementRatio).toBe(0);
    expect(result.viewsLast30Days).toEqual([]);
    expect(result.trackingSince).toBe('2026-09-24T00:00:00.000Z');
  });

  it('aggregates real qualified views, follower growth, and engagement ratio', async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue(baseProfile);

    // Channel has 2 videos
    prisma.video.findMany.mockResolvedValue([
      {
        id: 'v1',
        title: 'Video 1',
        status: 'PUBLISHED',
        thumbnailUrl: null,
        publishedAt: new Date('2026-09-20'),
        durationSeconds: 120,
      },
      {
        id: 'v2',
        title: 'Video 2',
        status: 'PUBLISHED',
        thumbnailUrl: null,
        publishedAt: new Date('2026-09-22'),
        durationSeconds: 180,
      },
    ]);

    // Followers
    prisma.channelFollow.count
      .mockResolvedValueOnce(150) // Total followers
      .mockResolvedValueOnce(25)  // New followers in last 30d
      .mockResolvedValueOnce(10); // Prev period followers

    // Views & Interactions
    prisma.videoView.count.mockResolvedValue(500); // Total views
    prisma.videoLike.count.mockResolvedValue(50);
    prisma.comment.count.mockResolvedValue(20);
    prisma.videoShare.count.mockResolvedValue(15);
    prisma.savedVideo.count.mockResolvedValue(15);
    prisma.watchHistory.count.mockResolvedValue(80);

    prisma.video.groupBy.mockResolvedValue([
      { status: 'PUBLISHED', _count: { _all: 2 } },
    ]);
    prisma.video.aggregate.mockResolvedValue({
      _sum: { durationSeconds: 300 },
    });
    prisma.watchHistory.aggregate.mockResolvedValue({
      _avg: { progressPercent: 65.5 },
    });

    // Per-video group by for top content
    prisma.videoView.groupBy.mockResolvedValue([
      { videoId: 'v1', _count: { _all: 300 } },
      { videoId: 'v2', _count: { _all: 200 } },
    ]);
    prisma.videoLike.groupBy.mockResolvedValue([
      { videoId: 'v1', _count: { _all: 30 } },
      { videoId: 'v2', _count: { _all: 20 } },
    ]);
    prisma.comment.groupBy.mockResolvedValue([]);
    prisma.videoShare.groupBy.mockResolvedValue([]);
    prisma.savedVideo.groupBy.mockResolvedValue([]);

    // 30-day time series
    prisma.videoView.findMany.mockResolvedValue([
      { viewedAt: new Date('2026-09-23T10:00:00Z') },
      { viewedAt: new Date('2026-09-23T12:00:00Z') },
    ]);
    prisma.videoLike.findMany.mockResolvedValue([]);
    prisma.channelFollow.findMany.mockResolvedValue([]);
    prisma.comment.findMany.mockResolvedValue([]);
    prisma.videoShare.findMany.mockResolvedValue([]);

    const result = await service.getAnalytics('u1');

    expect(result.totalViews).toBe(500);
    expect(result.followersCount).toBe(150);
    expect(result.newFollowersLast30Days).toBe(25);
    expect(result.prevPeriodFollowers).toBe(10);
    expect(result.totalLikes).toBe(50);
    expect(result.totalComments).toBe(20);
    expect(result.totalShares).toBe(15);
    expect(result.totalSaves).toBe(15);
    // Total interactions = 50 + 20 + 15 + 15 = 100
    // Engagement ratio = (100 / 500) * 100 = 20.0%
    expect(result.engagementRatio).toBe(20.0);
    expect(result.topVideos.length).toBe(2);
    expect(result.topVideos[0].id).toBe('v1');
    expect(result.topVideos[0].views).toBe(300);
    expect(result.trackingSince).toBe('2026-09-24T00:00:00.000Z');
  });
});
