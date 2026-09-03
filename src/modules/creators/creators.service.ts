import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { UpdateCreatorVerificationDto } from './dto/update-creator-verification.dto';

export interface AdminCreator {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  creatorProfile: {
    id: string;
    bio: string | null;
    isVerified: boolean;
    channel: {
      id: string;
      name: string;
      slug: string;
      isSuspended: boolean;
    } | null;
  } | null;
}

export interface CreatorQueryDto extends PaginationQueryDto {
  status?: UserStatus;
  verified?: string;
}

@Injectable()
export class CreatorsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(user: any): AdminCreator {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      creatorProfile: user.creatorProfile
        ? {
            id: user.creatorProfile.id,
            bio: user.creatorProfile.bio,
            isVerified: user.creatorProfile.isVerified,
            channel: user.creatorProfile.channel
              ? {
                  id: user.creatorProfile.channel.id,
                  name: user.creatorProfile.channel.name,
                  slug: user.creatorProfile.channel.slug,
                  isSuspended: user.creatorProfile.channel.isSuspended,
                }
              : null,
          }
        : null,
    };
  }

  async findAll(query: CreatorQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();

    const where: any = { role: UserRole.CREATOR };
    if (query.status) where.status = query.status;
    if (query.verified !== undefined) {
      where.creatorProfile = { isVerified: query.verified === 'true' };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        {
          creatorProfile: {
            channel: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [raw, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: {
          creatorProfile: {
            include: {
              channel: { select: { id: true, name: true, slug: true, isSuspended: true } },
            },
          },
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

  async findOne(id: string): Promise<AdminCreator> {
    const user = await this.prisma.user.findFirst({
      where: { id, role: UserRole.CREATOR },
      include: { creatorProfile: { include: { channel: { include: { category: true } } } } },
    });
    if (!user || !user.creatorProfile) {
      throw new NotFoundException('Creator not found');
    }
    return this.serialize(user);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, actorId: string): Promise<AdminCreator> {
    if (id === actorId) {
      throw new BadRequestException('You cannot suspend your own account');
    }
    const creator = await this.prisma.user.findFirst({
      where: { id, role: UserRole.CREATOR },
      include: { creatorProfile: { include: { channel: true } } },
    });
    if (!creator || !creator.creatorProfile) {
      throw new NotFoundException('Creator not found');
    }

    const channelId = creator.creatorProfile.channel?.id ?? null;

    // Keep the creator's channel suspension in sync with the account status.
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { status: dto.status },
        include: {
          creatorProfile: {
            include: {
              channel: { select: { id: true, name: true, slug: true, isSuspended: true } },
            },
          },
        },
      });
      if (channelId) {
        await tx.channel.update({
          where: { id: channelId },
          data: { isSuspended: dto.status === UserStatus.SUSPENDED },
        });
      }
      return user;
    });

    return this.serialize(updated);
  }

  async updateVerification(
    id: string,
    dto: UpdateCreatorVerificationDto,
  ): Promise<AdminCreator> {
    const creator = await this.prisma.user.findFirst({
      where: { id, role: UserRole.CREATOR },
      include: { creatorProfile: { include: { channel: { select: { id: true, name: true, slug: true, isSuspended: true } } } } },
    });
    if (!creator?.creatorProfile) {
      throw new NotFoundException('Creator not found');
    }
    await this.prisma.creatorProfile.update({
      where: { id: creator.creatorProfile.id },
      data: { isVerified: dto.isVerified },
    });
    return this.serialize({ ...creator, creatorProfile: { ...creator.creatorProfile, isVerified: dto.isVerified } });
  }
}
