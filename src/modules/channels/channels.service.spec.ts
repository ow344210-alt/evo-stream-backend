import { ConflictException, NotFoundException } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ChannelsService', () => {
  let service: ChannelsService;
  const prisma = {
    creatorProfile: { findUnique: jest.fn() },
    channel: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    category: { findUnique: jest.fn() },
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChannelsService(prisma);
  });

  it('creates the first channel with slug generated from the name', async () => {
    prisma.creatorProfile.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'profile-1', userId: 'u1', channel: null });
    prisma.channel.findUnique = jest.fn().mockResolvedValue(null);
    prisma.channel.create = jest.fn().mockResolvedValue({ id: 'chan-1', name: 'My Channel' });

    const result = await service.createMyChannel('u1', { name: 'My Channel' });

    expect(prisma.channel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'my-channel', creatorId: 'profile-1' }),
      }),
    );
    expect(result.id).toBe('chan-1');
  });

  it('allows only one channel per creator', async () => {
    prisma.creatorProfile.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'profile-1', userId: 'u1', channel: { id: 'c1' } });
    await expect(service.createMyChannel('u1', { name: 'Second' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws NotFoundException when fetching a channel for a creator without one', async () => {
    prisma.creatorProfile.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'profile-1', userId: 'u1', channel: null });
    await expect(service.getMyChannel('u1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the creator profile is missing', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue(null);
    await expect(service.getMyChannel('u1')).rejects.toThrow(NotFoundException);
  });

  it('validates category existence when creating a channel', async () => {
    prisma.creatorProfile.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'profile-1', userId: 'u1', channel: null });
    prisma.channel.findUnique = jest.fn().mockResolvedValue(null);
    prisma.category.findUnique = jest.fn().mockResolvedValue(null);

    await expect(
      service.createMyChannel('u1', { name: 'X', categoryId: 'nope' }),
    ).rejects.toThrow('does not exist');
  });
});
