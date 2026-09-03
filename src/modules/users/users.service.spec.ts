import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  const prisma = {
    user: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    creatorProfile: { count: jest.fn() },
    channel: { count: jest.fn() },
    video: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    category: { count: jest.fn() },
  } as unknown as PrismaService;

  const rawUser = {
    id: 'user-1',
    email: 'x@example.com',
    name: 'X',
    passwordHash: 'should-never-leak',
    role: UserRole.CREATOR,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    creatorProfile: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma);
  });

  it('serializes users without exposing passwordHash', async () => {
    prisma.user.findUnique = jest.fn().mockResolvedValue(rawUser);
    const result = await service.findOne('user-1');
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.email).toBe('x@example.com');
  });

  it('respects role/status filters and pagination', async () => {
    prisma.user.findMany = jest.fn().mockResolvedValue([rawUser]);
    prisma.user.count = jest.fn().mockResolvedValue(1);

    const result = await service.findAll({
      page: 2,
      pageSize: 10,
      role: UserRole.CREATOR,
      status: UserStatus.ACTIVE,
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: UserRole.CREATOR, status: UserStatus.ACTIVE }),
        skip: 10,
        take: 10,
      }),
    );
    expect(result.page).toBe(2);
    expect(result.total).toBe(1);
  });

  it('blocks suspending your own account', async () => {
    await expect(
      service.updateStatus('user-1', { status: UserStatus.SUSPENDED }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks suspending an admin account', async () => {
    prisma.user.findUnique = jest.fn().mockResolvedValue({
      ...rawUser,
      role: UserRole.ADMIN,
    });
    await expect(
      service.updateStatus('user-admin', { status: UserStatus.SUSPENDED }, 'actor-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for unknown user', async () => {
    prisma.user.findUnique = jest.fn().mockResolvedValue(null);
    await expect(
      service.updateStatus('nope', { status: UserStatus.ACTIVE }, 'actor-1'),
    ).rejects.toThrow(NotFoundException);
  });

  describe('updateRole', () => {
    it('promotes a USER to ADMIN', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...rawUser,
        id: 'viewer-1',
        role: UserRole.USER,
      });
      prisma.user.count = jest.fn().mockResolvedValue(3);
      prisma.user.update = jest.fn().mockResolvedValue({
        ...rawUser,
        id: 'viewer-1',
        role: UserRole.ADMIN,
      });
      const result = await service.updateRole('viewer-1', UserRole.ADMIN, 'admin-1');
      expect(result.role).toBe(UserRole.ADMIN);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: UserRole.ADMIN } }),
      );
    });

    it('promotes a CREATOR to ADMIN without deleting CreatorProfile', async () => {
      const creator = {
        ...rawUser,
        id: 'creator-1',
        role: UserRole.CREATOR,
        creatorProfile: { id: 'cp-1', isVerified: false, channel: null },
      };
      prisma.user.findUnique = jest.fn().mockResolvedValue(creator);
      prisma.user.count = jest.fn().mockResolvedValue(2);
      prisma.user.update = jest.fn().mockResolvedValue({
        ...creator,
        role: UserRole.ADMIN,
      });
      const result = await service.updateRole('creator-1', UserRole.ADMIN, 'admin-1');
      expect(result.role).toBe(UserRole.ADMIN);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: UserRole.ADMIN } }),
      );
    });

    it('returns current user without DB update when role is unchanged', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...rawUser,
        role: UserRole.CREATOR,
      });
      const result = await service.updateRole('user-1', UserRole.CREATOR, 'admin-1');
      expect(result.role).toBe(UserRole.CREATOR);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks self role change', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...rawUser,
        id: 'admin-1',
        role: UserRole.ADMIN,
      });
      await expect(
        service.updateRole('admin-1', UserRole.USER, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks demoting the last admin', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...rawUser,
        id: 'admin-1',
        role: UserRole.ADMIN,
      });
      prisma.user.count = jest.fn().mockResolvedValue(1);
      await expect(
        service.updateRole('admin-1', UserRole.USER, 'other-admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows demoting an admin when multiple admins exist', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...rawUser,
        id: 'admin-1',
        role: UserRole.ADMIN,
      });
      prisma.user.count = jest.fn().mockResolvedValue(2);
      prisma.user.update = jest.fn().mockResolvedValue({
        ...rawUser,
        id: 'admin-1',
        role: UserRole.USER,
      });
      const result = await service.updateRole('admin-1', UserRole.USER, 'other-admin');
      expect(result.role).toBe(UserRole.USER);
    });

    it('throws NotFoundException for unknown user', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue(null);
      await expect(
        service.updateRole('nope', UserRole.ADMIN, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('blocks promoting a USER to CREATOR without creator onboarding', async () => {
      prisma.user.findUnique = jest.fn().mockResolvedValue({
        ...rawUser,
        id: 'viewer-1',
        role: UserRole.USER,
      });
      await expect(
        service.updateRole('viewer-1', UserRole.CREATOR, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getDashboardStats', () => {
    it('aggregates real database counts and recent items', async () => {
      prisma.user.count = jest.fn().mockResolvedValue(120);
      prisma.creatorProfile.count = jest.fn().mockResolvedValue(14);
      prisma.channel.count = jest.fn().mockResolvedValue(12);
      prisma.video.count = jest.fn().mockResolvedValue(200);
      prisma.category.count = jest.fn().mockResolvedValue(6);

      prisma.video.findMany = jest.fn().mockResolvedValue([
        {
          id: 'vid-1',
          title: 'Sample Video',
          status: 'PUBLISHED',
          createdAt: new Date(),
          channel: { id: 'c-1', name: 'Channel A' },
          category: { id: 'cat-1', name: 'Drama' },
          _count: { likes: 3, comments: 5 },
        },
      ]);

      prisma.user.findMany = jest.fn().mockResolvedValue([
        {
          id: 'u-1',
          name: 'Creator One',
          email: 'c@example.com',
          createdAt: new Date(),
          creatorProfile: {
            id: 'cp-1',
            isVerified: true,
            channel: { id: 'c-1', name: 'Channel A', slug: 'channel-a' },
          },
        },
      ]);

      const result = await service.getDashboardStats();

      expect(result.totalUsers).toBe(120);
      expect(result.totalCreators).toBe(14);
      expect(result.totalChannels).toBe(12);
      expect(result.totalVideos).toBe(200);
      expect(result.totalCategories).toBe(6);
      expect(result.recentVideos[0].title).toBe('Sample Video');
      expect(result.recentVideos[0]._count.comments).toBe(5);
      expect(result.recentCreators[0].creatorProfile?.channel?.name).toBe('Channel A');
    });

    it('queries recent creators filtered to CREATOR role', async () => {
      prisma.video.findMany = jest.fn().mockResolvedValue([]);
      prisma.user.findMany = jest.fn().mockResolvedValue([]);

      await service.getDashboardStats();

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: UserRole.CREATOR },
          take: 3,
        }),
      );
    });
  });
});

