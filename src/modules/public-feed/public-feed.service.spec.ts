import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import { PublicFeedService, type PublicVideoCard } from './public-feed.service';
import { PrismaService } from '../../prisma/prisma.service';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    title: 'Amazing Man',
    description: 'desc',
    durationSeconds: 26,
    posterThumbnailKey: 'videos/v1/thumbnails/poster.jpg',
    publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    channel: { id: 'c1', name: 'DG Test Studio', slug: 'dg-test' },
    category: { id: 'cat1', name: 'Music', slug: 'music' },
    ...overrides,
  };
}

function expectEligible(where: any) {
  expect(where.status).toBe(VideoStatus.PUBLISHED);
  expect(where.processingStatus).toBe(VideoProcessingStatus.READY);
}

describe('PublicFeedService', () => {
  let service: PublicFeedService;
  let prisma: {
    video: { count: jest.Mock; findMany: jest.Mock };
    category: { findFirst: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let rows: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    rows = [
      row(),
      row({
        id: 'v2',
        title: 'Shadows',
        publishedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ];
    prisma = {
      video: {
        count: jest.fn().mockResolvedValue(rows.length),
        findMany: jest.fn().mockResolvedValue(rows.slice()),
      },
      category: { findFirst: jest.fn(), findUnique: jest.fn() },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    };
    service = new PublicFeedService(prisma as unknown as PrismaService);
  });

  describe('eligibility + pagination', () => {
    it('only queries READY + PUBLISHED and orders latest first', async () => {
      const res = await service.latest({ page: 1, pageSize: 20 });
      const args = prisma.video.findMany.mock.calls[0][0];
      expectEligible(args.where);
      expect(args.orderBy).toEqual([{ publishedAt: 'desc' }, { createdAt: 'desc' }]);
      expect(prisma.video.count).toHaveBeenCalledWith({
        where: { status: VideoStatus.PUBLISHED, processingStatus: VideoProcessingStatus.READY },
      });
      expect(res.items.length).toBe(2);
      expect(res.totalPages).toBe(1);
    });

    it('paginates with skip/take', async () => {
      const res = await service.latest({ page: 2, pageSize: 1 });
      const args = prisma.video.findMany.mock.calls[0][0];
      expect(args.skip).toBe(1);
      expect(args.take).toBe(1);
      expect(res.page).toBe(2);
      expect(res.total).toBe(rows.length);
      expect(res.totalPages).toBe(2);
    });
  });

  describe('safe serialization', () => {
    it('exposes safe public fields only (no storage keys / paths)', async () => {
      const res = await service.latest({ page: 1, pageSize: 20 });
      const card: PublicVideoCard = res.items[0];
      expect(card).toEqual({
        id: 'v1',
        title: 'Amazing Man',
        description: 'desc',
        durationSeconds: 26,
        posterUrl: '/api/media/v1/thumbnails/poster.jpg',
        publishedAt: '2026-09-01T00:00:00.000Z',
        channel: { id: 'c1', name: 'DG Test Studio', slug: 'dg-test' },
        category: { id: 'cat1', name: 'Music', slug: 'music' },
      });
      expect('posterThumbnailKey' in card).toBe(false);
      expect(JSON.stringify(card)).not.toContain('storage');
    });

    it('returns null poster when there is no thumbnail key', async () => {
      rows[0].posterThumbnailKey = null;
      const res = await service.latest({ page: 1, pageSize: 20 });
      expect(res.items[0].posterUrl).toBeNull();
    });
  });

  describe('trending (MVP deterministic)', () => {
    it('ranks by engagement then recency deterministically', async () => {
      rows = [
        row({ id: 'a', title: 'A', _count: { likes: 0, comments: 0, shares: 0 } }),
        row({ id: 'b', title: 'B', _count: { likes: 10, comments: 0, shares: 0 } }),
        row({ id: 'c', title: 'C', _count: { likes: 0, comments: 1, shares: 2 } }),
      ];
      prisma.video.findMany = jest.fn().mockResolvedValue(rows.slice());
      service = new PublicFeedService(prisma as unknown as PrismaService);

      const res = await service.trending({ page: 1, pageSize: 20 });
      const ids = res.items.map((i) => i.id);
      // b: 10 likes*1 =10 ; c: comment 1*2 + share 2*3 =8 ; a: 0
      expect(ids).toEqual(['b', 'c', 'a']);
    });

    it('keeps the eligibility filter for trending', async () => {
      rows = [
        row({ id: 'a', _count: { likes: 0, comments: 0, shares: 0 } }),
      ];
      prisma.video.findMany = jest.fn().mockResolvedValue(rows.slice());
      service = new PublicFeedService(prisma as unknown as PrismaService);

      await service.trending({ page: 1, pageSize: 20 });
      const args = prisma.video.findMany.mock.calls[0][0];
      expectEligible(args.where);
    });
  });

  describe('category filter', () => {
    it('resolves by slug and filters eligible videos by categoryId', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'cat1', slug: 'music' });
      const res = await service.byCategory({ page: 1, pageSize: 20, category: 'music' });
      const args = prisma.video.findMany.mock.calls[0][0];
      expect(args.where.categoryId).toBe('cat1');
      expectEligible(args.where);
      expect(res.total).toBe(rows.length);
    });

    it('throws 404 for an unknown category', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.findUnique.mockResolvedValue(null);
      await expect(
        service.byCategory({ page: 1, pageSize: 20, category: 'nope' }),
      ).rejects.toThrow('Category not found');
    });
  });

  describe('search', () => {
    it('builds a title/channel OR search and keeps eligibility', async () => {
      await service.search({ page: 1, pageSize: 20, q: '  amazing  ' });
      const args = prisma.video.findMany.mock.calls[0][0];
      expect(args.where.OR).toEqual([
        { title: { contains: 'amazing', mode: 'insensitive' } },
        { channel: { name: { contains: 'amazing', mode: 'insensitive' } } },
      ]);
      expectEligible(args.where);
    });

    it('returns an empty page for a blank query', async () => {
      const res = await service.search({ page: 1, pageSize: 20, q: '   ' });
      expect(res.items).toEqual([]);
      expect(res.total).toBe(0);
      expect(prisma.video.findMany).not.toHaveBeenCalled();
    });
  });
});
