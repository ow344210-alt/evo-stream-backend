import { NotFoundException } from '@nestjs/common';
import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import { LikesService } from './likes.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LikesService', () => {
  let service: LikesService;
  let prisma: {
    videoLike: {
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
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
      videoLike: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    playback = { assertEligible: jest.fn().mockResolvedValue(eligible) };
    service = new LikesService(
      prisma as unknown as PrismaService,
      playback as unknown as VideoPlaybackService,
    );
  });

  describe('like', () => {
    it('creates a like when none exists and returns liked:true', async () => {
      prisma.videoLike.findUnique.mockResolvedValue(null);
      prisma.videoLike.count.mockResolvedValue(3);

      const result = await service.like('u1', 'v1');

      expect(playback.assertEligible).toHaveBeenCalledWith('v1');
      expect(prisma.videoLike.create).toHaveBeenCalledWith({
        data: { userId: 'u1', videoId: 'v1' },
      });
      expect(result).toEqual({ liked: true, likeCount: 3 });
    });

    it('is idempotent - does not create twice', async () => {
      prisma.videoLike.findUnique.mockResolvedValue({ id: 'like-1' });
      prisma.videoLike.count.mockResolvedValue(1);

      const result = await service.like('u1', 'v1');

      expect(prisma.videoLike.create).not.toHaveBeenCalled();
      expect(result.liked).toBe(true);
    });

    it('propagates NotFound when video is not eligible', async () => {
      playback.assertEligible.mockRejectedValue(
        new NotFoundException('Video is not available'),
      );
      await expect(service.like('u1', 'v1')).rejects.toThrow(NotFoundException);
      expect(prisma.videoLike.create).not.toHaveBeenCalled();
    });
  });

  describe('unlike', () => {
    it('deletes an existing like and returns liked:false', async () => {
      prisma.videoLike.findUnique.mockResolvedValue({ id: 'like-1' });
      prisma.videoLike.count.mockResolvedValue(2);

      const result = await service.unlike('u1', 'v1');

      expect(prisma.videoLike.delete).toHaveBeenCalledWith({
        where: { id: 'like-1' },
      });
      expect(result).toEqual({ liked: false, likeCount: 2 });
    });

    it('is idempotent - no delete when no like exists', async () => {
      prisma.videoLike.findUnique.mockResolvedValue(null);
      prisma.videoLike.count.mockResolvedValue(0);

      const result = await service.unlike('u1', 'v1');

      expect(prisma.videoLike.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ liked: false, likeCount: 0 });
    });
  });

  describe('getLikedVideos', () => {
    it('returns paginated liked videos', async () => {
      const row = {
        id: 'like-1',
        video: { id: 'v1', title: 'T', channel: { id: 'c', name: 'N', slug: 'n' } },
      };
      prisma.videoLike.findMany.mockResolvedValue([row]);
      prisma.videoLike.count.mockResolvedValue(1);

      const result = await service.getLikedVideos('u1', { page: 1, pageSize: 20 });

      expect(prisma.videoLike.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.items).toEqual([row.video]);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });
});
