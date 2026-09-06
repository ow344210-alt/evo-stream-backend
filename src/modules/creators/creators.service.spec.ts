import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { CreatorsService } from './creators.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationCacheService } from '../../auth/user-validation-cache.service';

describe('CreatorsService', () => {
  let service: CreatorsService;
  const prisma = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    channel: { update: jest.fn() },
    creatorProfile: { update: jest.fn() },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const rawCreator = {
    id: 'creator-1',
    email: 'c@example.com',
    name: 'C',
    passwordHash: 'secret',
    role: UserRole.CREATOR,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    creatorProfile: {
      id: 'profile-1',
      bio: 'bio',
      isVerified: false,
      channel: { id: 'chan-1', name: 'Chan', slug: 'chan', isSuspended: false },
    },
  };

beforeEach(() => {
    jest.clearAllMocks();
    service = new CreatorsService(prisma, UserValidationCacheService.create());
  });

  it('series only role CREATOR users and hides passwordHash', async () => {
    prisma.user.findMany = jest.fn().mockResolvedValue([rawCreator]);
    prisma.user.count = jest.fn().mockResolvedValue(1);

    const result = await service.findAll({ page: 1, status: UserStatus.ACTIVE });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: UserRole.CREATOR }) }),
    );
    expect(result.items[0]).not.toHaveProperty('passwordHash');
  });

  it('blocks self-suspension', async () => {
    await expect(
      service.updateStatus('creator-1', { status: UserStatus.SUSPENDED }, 'creator-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('syncs channel suspension when a creator is suspended', async () => {
    prisma.user.findFirst = jest.fn().mockResolvedValue(rawCreator);
    (prisma.$transaction as unknown as jest.Mock) = jest.fn(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        user: {
          update: jest.fn().mockResolvedValue(rawCreator),
        },
        channel: {
          update: jest.fn().mockResolvedValue({}),
        },
      };
      return fn(tx);
    });

    await service.updateStatus('creator-1', { status: UserStatus.SUSPENDED }, 'actor-1');

    const tx = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    await expect(Promise.resolve((tx as any).channel)).toBeDefined();
  });

  it('throws NotFoundException for a non-creator user', async () => {
    prisma.user.findFirst = jest.fn().mockResolvedValue(null);
    await expect(
      service.updateVerification('nope', { isVerified: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it('updates verification flag', async () => {
    prisma.user.findFirst = jest.fn().mockResolvedValue(rawCreator);
    prisma.creatorProfile.update = jest.fn().mockResolvedValue({});

    const result = await service.updateVerification('creator-1', { isVerified: true });
    expect(prisma.creatorProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isVerified: true } }),
    );
    expect(result.creatorProfile?.isVerified).toBe(true);
  });
});

