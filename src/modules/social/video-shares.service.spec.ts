import { VideoSharesService } from './video-shares.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('VideoSharesService', () => {
  let service: VideoSharesService;
  let prisma: {
    videoShare: { create: jest.Mock; count: jest.Mock };
  };
  let playback: { assertEligible: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      videoShare: { create: jest.fn(), count: jest.fn() },
    };
    playback = { assertEligible: jest.fn().mockResolvedValue({ id: 'v1', channelId: 'c' }) };
    service = new VideoSharesService(
      prisma as unknown as PrismaService,
      playback as unknown as VideoPlaybackService,
    );
  });

  it('records a share and returns the count', async () => {
    prisma.videoShare.count.mockResolvedValue(4);

    const result = await service.share('u1', 'v1');

    expect(playback.assertEligible).toHaveBeenCalledWith('v1');
    expect(prisma.videoShare.create).toHaveBeenCalledWith({
      data: { userId: 'u1', videoId: 'v1' },
    });
    expect(result).toEqual({ shared: true, shareCount: 4 });
  });
});
