import { SavedVideosService } from './saved-videos.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SavedVideosService', () => {
  let service: SavedVideosService;
  let prisma: {
    savedVideo: {
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let playback: { assertEligible: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      savedVideo: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    playback = { assertEligible: jest.fn().mockResolvedValue({ id: 'v1', channelId: 'c' }) };
    service = new SavedVideosService(
      prisma as unknown as PrismaService,
      playback as unknown as VideoPlaybackService,
    );
  });

  describe('save', () => {
    it('creates a save when none exists', async () => {
      prisma.savedVideo.findUnique.mockResolvedValue(null);
      const result = await service.save('u1', 'v1');
      expect(playback.assertEligible).toHaveBeenCalledWith('v1');
      expect(prisma.savedVideo.create).toHaveBeenCalledWith({
        data: { userId: 'u1', videoId: 'v1' },
      });
      expect(result).toEqual({ saved: true });
    });

    it('is idempotent', async () => {
      prisma.savedVideo.findUnique.mockResolvedValue({ id: 's1' });
      const result = await service.save('u1', 'v1');
      expect(prisma.savedVideo.create).not.toHaveBeenCalled();
      expect(result.saved).toBe(true);
    });
  });

  describe('unsave', () => {
    it('deletes an existing save', async () => {
      prisma.savedVideo.findUnique.mockResolvedValue({ id: 's1' });
      const result = await service.unsave('u1', 'v1');
      expect(prisma.savedVideo.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(result).toEqual({ saved: false });
    });

    it('is idempotent', async () => {
      prisma.savedVideo.findUnique.mockResolvedValue(null);
      const result = await service.unsave('u1', 'v1');
      expect(prisma.savedVideo.delete).not.toHaveBeenCalled();
      expect(result.saved).toBe(false);
    });
  });

  describe('getSavedVideos', () => {
    it('returns paginated saved videos', async () => {
      const row = {
        id: 's1',
        video: { id: 'v1', title: 'T', channel: { id: 'c', name: 'N', slug: 'n' } },
      };
      prisma.savedVideo.findMany.mockResolvedValue([row]);
      prisma.savedVideo.count.mockResolvedValue(1);

      const result = await service.getSavedVideos('u1', { page: 1, pageSize: 20 });

      expect(result.items).toEqual([row.video]);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });
});
