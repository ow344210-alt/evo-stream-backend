import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserValidationCacheService } from '../../auth/user-validation-cache.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

export interface AdminDashboardStats {
  totalUsers: number;
  totalCreators: number;
  totalChannels: number;
  totalVideos: number;
  totalCategories: number;
  recentVideos: {
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    channel: { id: string; name: string };
    category: { id: string; name: string } | null;
    _count: { likes: number; comments: number };
  }[];
  recentCreators: {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
    creatorProfile: {
      id: string;
      isVerified: boolean;
      channel: { id: string; name: string; slug: string } | null;
    } | null;
  }[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  creatorProfile?: {
    id: string;
    isVerified: boolean;
    channel?: { id: string; name: string; slug: string } | null;
  } | null;
}

export interface UserQueryDto extends PaginationQueryDto {
  role?: UserRole;
  status?: UserStatus;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userCache: UserValidationCacheService,
  ) {}

  private serialize(user: any): AdminUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      creatorProfile: user.creatorProfile
        ? {
            id: user.creatorProfile.id,
            isVerified: user.creatorProfile.isVerified,
            channel: user.creatorProfile.channel
              ? {
                  id: user.creatorProfile.channel.id,
                  name: user.creatorProfile.channel.name,
                  slug: user.creatorProfile.channel.slug,
                }
              : null,
          }
        : null,
    };
  }

  async findAll(query: UserQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();

    const where: any = {};
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [raw, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          creatorProfile: { include: { channel: { select: { id: true, name: true, slug: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: raw.map((u) => this.serialize(u)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        creatorProfile: { include: { channel: { select: { id: true, name: true, slug: true } } } },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.serialize(user);
  }

  async updateRole(id: string, role: UserRole, actorId: string): Promise<AdminUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (id === actorId) {
      throw new BadRequestException('You cannot change your own role');
    }
    if (user.role === role) {
      return this.serialize(user);
    }
    if (role === UserRole.CREATOR && user.role === UserRole.USER) {
      throw new BadRequestException(
        'Promoting a viewer to creator requires creator onboarding. Use the creator registration/onboarding flow instead.',
      );
    }
    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: { role: UserRole.ADMIN },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('At least one administrator must remain');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { role },
      include: {
        creatorProfile: { include: { channel: { select: { id: true, name: true, slug: true } } } },
      },
    });
    // Role is part of the validated JWT user object (RBAC input); drop the
    // cached validation so the next request reflects the new permissions.
    this.userCache.invalidateUser(id);
    return this.serialize(updated);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, actorId: string): Promise<AdminUser> {
    if (id === actorId) {
      throw new BadRequestException('You cannot suspend your own account');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role === UserRole.ADMIN && dto.status === UserStatus.SUSPENDED) {
      throw new BadRequestException('Administrator accounts cannot be suspended');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      include: {
        creatorProfile: { include: { channel: { select: { id: true, name: true, slug: true } } } },
      },
    });
    // Status guards account activation/suspension; invalidate the cached
    // validation immediately so a suspend/unsuspend takes effect on the next
    // authenticated request instead of waiting out the TTL.
    this.userCache.invalidateUser(id);
    return this.serialize(updated);
  }

  async getDashboardStats(): Promise<AdminDashboardStats> {
    const [
      totalUsers,
      totalCreators,
      totalChannels,
      totalVideos,
      totalCategories,
      rawRecentVideos,
      rawRecentCreators,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.creatorProfile.count(),
      this.prisma.channel.count(),
      this.prisma.video.count(),
      this.prisma.category.count(),
      this.prisma.video.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          channel: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          _count: { select: { likes: true, comments: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { role: UserRole.CREATOR },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          creatorProfile: {
            select: {
              id: true,
              isVerified: true,
              channel: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      }),
    ]);

    return {
      totalUsers,
      totalCreators,
      totalChannels,
      totalVideos,
      totalCategories,
      recentVideos: rawRecentVideos,
      recentCreators: rawRecentCreators,
    };
  }
}
