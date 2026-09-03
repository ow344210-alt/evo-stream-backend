import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CommentsService', () => {
  let service: CommentsService;
  let prisma: {
    comment: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let playback: { assertEligible: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      comment: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    playback = { assertEligible: jest.fn().mockResolvedValue({ id: 'v1', channelId: 'c' }) };
    service = new CommentsService(
      prisma as unknown as PrismaService,
      playback as unknown as VideoPlaybackService,
    );
  });

  describe('create', () => {
    it('requires eligibility before creating', async () => {
      prisma.comment.create.mockResolvedValue({ id: 'cm' });
      const result = await service.create('u1', 'v1', { content: '  hello  ' });
      expect(playback.assertEligible).toHaveBeenCalledWith('v1');
      expect(prisma.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { content: 'hello', userId: 'u1', videoId: 'v1', parentId: undefined },
        }),
      );
      expect(result).toEqual({ id: 'cm' });
    });

    it('rejects a reply whose parent is missing', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);
      await expect(
        service.create('u1', 'v1', { content: 'x', parentId: 'parent-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.comment.create).not.toHaveBeenCalled();
    });

    it('rejects a reply to a comment on a different video', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 'parent-1', videoId: 'v2', parentId: null });
      await expect(
        service.create('u1', 'v1', { content: 'x', parentId: 'parent-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects replying to a reply', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 'parent-1', videoId: 'v1', parentId: 'root' });
      await expect(
        service.create('u1', 'v1', { content: 'x', parentId: 'parent-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('returns root comments when no parentId', async () => {
      prisma.comment.findMany.mockResolvedValue([{ id: 'cm' }]);
      prisma.comment.count.mockResolvedValue(1);

      const result = await service.list('v1', { page: 1, pageSize: 20 } as never);

      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { videoId: 'v1', parentId: null } }),
      );
      expect(result.items).toEqual([{ id: 'cm' }]);
    });

    it('filters by parentId for replies', async () => {
      prisma.comment.findMany.mockResolvedValue([]);
      prisma.comment.count.mockResolvedValue(0);

      await service.list('v1', { page: 1, pageSize: 20, parentId: 'parent-1' } as never);

      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { videoId: 'v1', parentId: 'parent-1' } }),
      );
    });
  });

  describe('update', () => {
    it('lets the owner edit their comment', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 'cm', userId: 'u1' });
      prisma.comment.update.mockResolvedValue({ id: 'cm' });

      const result = await service.update('u1', 'cm', { content: 'new' });

      expect(prisma.comment.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cm' }, data: { content: 'new' } }),
      );
      expect(result).toEqual({ id: 'cm' });
    });

    it('forbids editing another users comment', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 'cm', userId: 'u2' });
      await expect(
        service.update('u1', 'cm', { content: 'new' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound for a missing comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);
      await expect(service.update('u1', 'cm', { content: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('lets the owner delete their comment', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 'cm', userId: 'u1' });
      const result = await service.remove('u1', 'cm');
      expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'cm' } });
      expect(result.message).toContain('deleted');
    });

    it('forbids deleting another users comment', async () => {
      prisma.comment.findUnique.mockResolvedValue({ id: 'cm', userId: 'u2' });
      await expect(service.remove('u1', 'cm')).rejects.toThrow(ForbiddenException);
      expect(prisma.comment.delete).not.toHaveBeenCalled();
    });
  });
});
