import { WatchHistoryService } from './watch-history.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('WatchHistoryService', () => {
  let service: WatchHistoryService;
  let prisma: {
    watchHistory: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let playback: { assertEligible: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      watchHistory: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    playback = { assertEligible: jest.fn().mockResolvedValue({ id: 'v1', channelId: 'c' }) };
    service = new WatchHistoryService(
      prisma as unknown as PrismaService,
      playback as unknown as VideoPlaybackService,
    );
  });

  describe('recordProgress', () => {
    it('upserts with clamped progress and defaults', async () => {
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'h1' });

      const result = await service.recordProgress('u1', 'v1', {
        positionSeconds: 15,
        progressPercent: 120,
      });

      expect(playback.assertEligible).toHaveBeenCalledWith('v1');
      expect(prisma.watchHistory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_videoId: { userId: 'u1', videoId: 'v1' } },
          create: expect.objectContaining({ progressPercent: 100 }),
          update: expect.objectContaining({ positionSeconds: 15, progressPercent: 100 }),
        }),
      );
      expect(result).toEqual({ id: 'h1' });
    });

    it('defaults missing values to zero', async () => {
      prisma.watchHistory.upsert.mockResolvedValue({ id: 'h1' });
      await service.recordProgress('u1', 'v1', {});
      const call = prisma.watchHistory.upsert.mock.calls[0][0];
      expect(call.create.positionSeconds).toBe(0);
      expect(call.create.progressPercent).toBe(0);
    });
  });

  describe('getHistory', () => {
    it('returns paginated history mapped to video + progress', async () => {
      const row = {
        positionSeconds: 10,
        progressPercent: 50,
        watchedAt: new Date(),
        video: { id: 'v1', title: 'T', channel: { id: 'c', name: 'N', slug: 'n' } },
      };
      prisma.watchHistory.findMany.mockResolvedValue([row]);
      prisma.watchHistory.count.mockResolvedValue(1);

      const result = await service.getHistory('u1', { page: 1, pageSize: 20 });

      expect(result.items[0]).toEqual({
        positionSeconds: 10,
        progressPercent: 50,
        watchedAt: row.watchedAt,
        video: row.video,
      });
      expect(result.total).toBe(1);
    });
  });

  describe('removeHistoryItem', () => {
    it('deletes an existing history row', async () => {
      prisma.watchHistory.findUnique.mockResolvedValue({ id: 'h1' });
      const result = await service.removeHistoryItem('u1', 'v1');
      expect(prisma.watchHistory.delete).toHaveBeenCalledWith({ where: { id: 'h1' } });
      expect(result.message).toContain('removed');
    });

    it('is idempotent when no history exists', async () => {
      prisma.watchHistory.findUnique.mockResolvedValue(null);
      const result = await service.removeHistoryItem('u1', 'v1');
      expect(prisma.watchHistory.delete).not.toHaveBeenCalled();
      expect(result.message).toContain('removed');
    });
  });
});
