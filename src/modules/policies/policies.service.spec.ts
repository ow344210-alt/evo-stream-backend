import { ConflictException, NotFoundException } from '@nestjs/common';
import { PoliciesService } from './policies.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PoliciesService', () => {
  let service: PoliciesService;
  const prisma = {
    platformPolicy: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PoliciesService(prisma);
  });

  it('creates a policy', async () => {
    prisma.platformPolicy.findUnique = jest.fn().mockResolvedValue(null);
    prisma.platformPolicy.create = jest.fn().mockResolvedValue({ id: 'p1', title: 'Terms' });

    const result = await service.create({
      title: ' Terms ',
      slug: 'terms-and-conditions',
      content: 'text',
    });

    expect(prisma.platformPolicy.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Terms' }) }),
    );
    expect(result.id).toBe('p1');
  });

  it('rejects duplicate slug', async () => {
    prisma.platformPolicy.findUnique = jest.fn().mockResolvedValue({ id: 'p1' });
    await expect(
      service.create({ title: 'Terms', slug: 'terms-and-conditions', content: 'x' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when updating a missing policy', async () => {
    prisma.platformPolicy.findUnique = jest.fn().mockResolvedValue(null);
    await expect(service.update('nope', { title: 'New' })).rejects.toThrow(NotFoundException);
  });

  it('lists only active policies for public consumption', async () => {
    prisma.platformPolicy.findMany = jest.fn().mockResolvedValue([{ id: 'p1' }]);
    const result = await service.findActive();
    expect(result).toHaveLength(1);
    expect(prisma.platformPolicy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });
});
