import { NotFoundException } from '@nestjs/common';
import { VideoStatus } from '@prisma/client';
import { CreatorDashboardService } from './creator-dashboard.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CreatorDashboardService', () => {
  let service: CreatorDashboardService;
  const prisma = {
    creatorProfile: { findUnique: jest.fn() },
    video: { groupBy: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    channelFollow: { count: jest.fn() },
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreatorDashboardService(prisma);
  });

  const baseProfile = {
    id: 'profile-1',
    userId: 'u1',
    bio: 'A bio',
    isVerified: true,
    user: { id: 'u1', name: 'Ada', email: 'ada@test.com' },
    channel: {
      id: 'chan-1',
      name: 'Ada Studio',
      slug: 'ada-studio',
      description: 'desc',
      logoUrl: null,
      bannerUrl: null,
      websiteUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      twitterUrl: null,
      isSuspended: false,
      category: null,
    },
  };

  it('throws NotFound when the creator profile is missing', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue(null);
    await expect(service.getDashboard('other-user')).rejects.toThrow(NotFoundException);
  });

  it('returns an empty dashboard for a creator with no channel yet', async () => {
    prisma.creatorProfile.findUnique = jest
      .fn()
      .mockResolvedValue({
        id: 'profile-1',
        userId: 'u1',
        bio: null,
        isVerified: false,
        user: { id: 'u1', name: 'Ada', email: 'ada@test.com' },
        channel: null,
      });

    const result = await service.getDashboard('u1');

    expect(result.channel).toBeNull();
    expect(result.stats).toEqual({
      totalVideos: 0,
      draftCount: 0,
      publishedCount: 0,
      hiddenCount: 0,
      processingCount: 0,
      followersCount: 0,
    });
    expect(result.recentVideos).toEqual([]);
    // No video/channelFollow queries are needed when there is no channel.
    expect(prisma.video.groupBy).not.toHaveBeenCalled();
    expect(prisma.video.count).not.toHaveBeenCalled();
    expect(prisma.channelFollow.count).not.toHaveBeenCalled();
  });

  it('aggregates real stats scoped to the authenticated creator channel', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue(baseProfile);
    prisma.video.groupBy = jest.fn().mockResolvedValue([
      { status: VideoStatus.DRAFT, _count: { _all: 2 } },
      { status: VideoStatus.PUBLISHED, _count: { _all: 3 } },
      { status: VideoStatus.HIDDEN, _count: { _all: 1 } },
    ]);
    prisma.video.count = jest.fn().mockResolvedValue(1);
    prisma.channelFollow.count = jest.fn().mockResolvedValue(1200);
    prisma.video.findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'v1', title: 'Latest', status: 'PUBLISHED', processingStatus: 'READY' },
      ]);

    const result = await service.getDashboard('u1');

    expect(result.stats).toEqual({
      totalVideos: 6,
      draftCount: 2,
      publishedCount: 3,
      hiddenCount: 1,
      processingCount: 1,
      followersCount: 1200,
    });
    expect(result.channel?.name).toBe('Ada Studio');
    expect(result.recentVideos).toHaveLength(1);

    // Ownership isolation: every query is filtered to the authenticated user's
    // channel only, never an arbitrary client-supplied channel id.
    expect(prisma.video.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: 'chan-1' } }),
    );
    expect(prisma.video.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ channelId: 'chan-1' }) }),
    );
    expect(prisma.channelFollow.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ channelId: 'chan-1' }) }),
    );
    expect(prisma.video.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: 'chan-1' }, take: 5 }),
    );
  });

  it('defaults status counts to zero for statuses not present', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue(baseProfile);
    prisma.video.groupBy = jest.fn().mockResolvedValue([]);
    prisma.video.count = jest.fn().mockResolvedValue(0);
    prisma.channelFollow.count = jest.fn().mockResolvedValue(0);
    prisma.video.findMany = jest.fn().mockResolvedValue([]);

    const result = await service.getDashboard('u1');
    expect(result.stats).toEqual({
      totalVideos: 0,
      draftCount: 0,
      publishedCount: 0,
      hiddenCount: 0,
      processingCount: 0,
      followersCount: 0,
    });
  });
});
