import { NotFoundException } from '@nestjs/common';
import { FollowsService } from './follows.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('FollowsService', () => {
  let service: FollowsService;
  let prisma: {
    channel: { findUnique: jest.Mock };
    channelFollow: {
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      channel: { findUnique: jest.fn() },
      channelFollow: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new FollowsService(prisma as unknown as PrismaService);
  });

  describe('follow', () => {
    it('creates a follow on an existing channel', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 'c1', name: 'N', slug: 'n' });
      prisma.channelFollow.findUnique.mockResolvedValue(null);
      prisma.channelFollow.count.mockResolvedValue(5);

      const result = await service.follow('u1', 'c1');

      expect(prisma.channelFollow.create).toHaveBeenCalledWith({
        data: { userId: 'u1', channelId: 'c1' },
      });
      expect(result).toEqual({
        following: true,
        channel: { id: 'c1', name: 'N', slug: 'n' },
        followerCount: 5,
      });
    });

    it('throws NotFound when channel does not exist', async () => {
      prisma.channel.findUnique.mockResolvedValue(null);
      await expect(service.follow('u1', 'c1')).rejects.toThrow(NotFoundException);
      expect(prisma.channelFollow.create).not.toHaveBeenCalled();
    });

    it('is idempotent - no duplicate follow', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 'c1', name: 'N', slug: 'n' });
      prisma.channelFollow.findUnique.mockResolvedValue({ id: 'f1' });
      prisma.channelFollow.count.mockResolvedValue(1);

      const result = await service.follow('u1', 'c1');

      expect(prisma.channelFollow.create).not.toHaveBeenCalled();
      expect(result.following).toBe(true);
    });
  });

  describe('unfollow', () => {
    it('deletes an existing follow', async () => {
      prisma.channel.findUnique.mockResolvedValue({ id: 'c1' });
      prisma.channelFollow.findUnique.mockResolvedValue({ id: 'f1' });
      prisma.channelFollow.count.mockResolvedValue(0);

      const result = await service.unfollow('u1', 'c1');

      expect(prisma.channelFollow.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
      expect(result).toEqual({ following: false, followerCount: 0 });
    });

    it('throws NotFound for a missing channel', async () => {
      prisma.channel.findUnique.mockResolvedValue(null);
      await expect(service.unfollow('u1', 'c1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFollowing', () => {
    it('returns paginated followed channels', async () => {
      const row = { id: 'f1', channel: { id: 'c1', name: 'N', slug: 'n' } };
      prisma.channelFollow.findMany.mockResolvedValue([row]);
      prisma.channelFollow.count.mockResolvedValue(1);

      const result = await service.getFollowing('u1', { page: 1, pageSize: 20 });

      expect(result.items).toEqual([row.channel]);
      expect(result.total).toBe(1);
    });
  });
});
