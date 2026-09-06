import { ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  const prisma = {
    category: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    channel: { updateMany: jest.fn() },
    video: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CategoriesService(prisma);
  });

  it('creates a category with a generated slug and named fields', async () => {
    prisma.category.findFirst = jest.fn().mockResolvedValue(null);
    prisma.category.create = jest
      .fn()
      .mockResolvedValue({ id: 'cat-1', name: 'Drama & Cinema', slug: 'drama-cinema' });

    const result = await service.create({ name: 'Drama & Cinema', slug: '' });

    expect(prisma.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Drama & Cinema', slug: 'drama-cinema' }),
      }),
    );
    expect(result.slug).toBe('drama-cinema');
  });

  it('rejects duplicate category name or slug', async () => {
    prisma.category.findFirst = jest.fn().mockResolvedValue({ id: 'x' });
    await expect(service.create({ name: 'Drama', slug: 'drama' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws NotFoundException when updating a missing category', async () => {
    prisma.category.findUnique = jest.fn().mockResolvedValue(null);
    await expect(service.update('nope', { description: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists only active categories for public consumption', async () => {
    prisma.category.findMany = jest.fn().mockResolvedValue([{ id: 'c1' }]);
    const result = await service.findActive();
    expect(result).toHaveLength(1);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  describe('P1-2 public category listing (findActive)', () => {
    const cat = (id: string, name: string, featured = false) => ({
      id,
      name,
      slug: name.toLowerCase(),
      description: `${name} description`,
      icon: null,
      featured,
      isActive: true,
    });

    beforeEach(() => {
      prisma.category.findMany = jest.fn().mockResolvedValue([]);
      prisma.category.count = jest.fn().mockResolvedValue(0);
    });

    it('returns multiple active categories with all required fields', async () => {
      const cats = [cat('c1', 'Technology'), cat('c2', 'Education'), cat('c3', 'Entertainment')];
      prisma.category.findMany = jest.fn().mockResolvedValue(cats);

      const result = await service.findActive();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual(cat('c1', 'Technology'));
      expect(result.map((c) => c.name)).toEqual(['Technology', 'Education', 'Entertainment']);
      // Required fields mapped through untouched (id, name, slug, description, icon, featured, isActive).
      expect(result[0].description).toBe('Technology description');
    });

    it('orders by featured DESC then name ASC', async () => {
      const cats = [
        cat('c1', 'Zebra', true),
        cat('c2', 'Alpha'),
        cat('c3', 'Medium'),
      ];
      prisma.category.findMany = jest.fn().mockResolvedValue(cats);

      await service.findActive();

      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ featured: 'desc' }, { name: 'asc' }],
        }),
      );
    });

    it('returns a legitimate empty array when zero active categories exist', async () => {
      const result = await service.findActive();
      expect(result).toEqual([]);
      expect(prisma.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('propagates service/database errors rather than reporting an empty list', async () => {
      prisma.category.findMany = jest.fn().mockRejectedValue(new Error('db down'));
      await expect(service.findActive()).rejects.toThrow('db down');
    });
  });

  it('reclassifies videos/channels then deletes a category', async () => {
    prisma.category.findUnique = jest.fn().mockResolvedValue({ id: 'c1' });
    prisma.category.delete = jest.fn().mockResolvedValue({ id: 'c1' });
    await service.remove('c1');
    expect(prisma.channel.updateMany).toHaveBeenCalled();
    expect(prisma.video.updateMany).toHaveBeenCalled();
    expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });
});
