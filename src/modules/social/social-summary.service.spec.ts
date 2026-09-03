import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import { SocialSummaryService } from './social-summary.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SocialSummaryService', () => {
  let service: SocialSummaryService;
  let prisma: {
    videoLike: { count: jest.Mock; findUnique: jest.Mock };
    comment: { count: jest.Mock };
    videoShare: { count: jest.Mock };
    savedVideo: { findUnique: jest.Mock };
    channelFollow: { count: jest.Mock; findUnique: jest.Mock };
  };
  let playback: { assertEligible: jest.Mock };

  const eligible = {
    id: 'v1',
    channelId: 'chan-1',
    processingStatus: VideoProcessingStatus.READY,
    status: VideoStatus.PUBLISHED,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      videoLike: { count: jest.fn().mockResolvedValue(3), findUnique: jest.fn() },
      comment: { count: jest.fn().mockResolvedValue(2) },
      videoShare: { count: jest.fn().mockResolvedValue(1) },
      savedVideo: { findUnique: jest.fn() },
      channelFollow: { count: jest.fn().mockResolvedValue(5), findUnique: jest.fn() },
    };
    playback = { assertEligible: jest.fn().mockResolvedValue(eligible) };
    service = new SocialSummaryService(
      prisma as unknown as PrismaService,
      playback as unknown as VideoPlaybackService,
    );
  });

  it('returns counts with no viewer flags for a public request', async () => {
    const result = await service.getSummary('v1');

    expect(result).toEqual({
      videoId: 'v1',
      likeCount: 3,
      commentCount: 2,
      shareCount: 1,
      channelFollowerCount: 5,
      isLiked: false,
      isSaved: false,
      isFollowing: false,
    });
    expect(prisma.videoLike.findUnique).not.toHaveBeenCalled();
    expect(prisma.channelFollow.count).toHaveBeenCalledWith({
      where: { channelId: 'chan-1' },
    });
  });

  it('exposes viewer flags when authenticated', async () => {
    prisma.videoLike.findUnique.mockResolvedValue({ id: 'l1' });
    prisma.savedVideo.findUnique.mockResolvedValue(null);
    prisma.channelFollow.findUnique.mockResolvedValue({ id: 'f1' });

    const result = await service.getSummary('v1', 'u1');

    expect(result.isLiked).toBe(true);
    expect(result.isSaved).toBe(false);
    expect(result.isFollowing).toBe(true);
    expect(prisma.channelFollow.findUnique).toHaveBeenCalledWith({
      where: { userId_channelId: { userId: 'u1', channelId: 'chan-1' } },
    });
  });
});
