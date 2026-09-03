import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async ensureUniqueSlug(slug: string, excludeId?: string): Promise<string> {
    let candidate = slug;
    if (excludeId) {
      const clash = await this.prisma.channel.findFirst({
        where: { slug: candidate, NOT: { id: excludeId } },
      });
      if (!clash) return candidate;
    } else {
      const clash = await this.prisma.channel.findUnique({ where: { slug: candidate } });
      if (!clash) return candidate;
    }
    // If explicitly provided slug is taken, disambiguate rather than silently changing it.
    throw new ConflictException('This channel slug is already in use');
  }

  async getCreatorProfile(userId: string) {
    const profile = await this.prisma.creatorProfile.findUnique({
      where: { userId },
      include: {
        channel: { include: { category: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException('Creator profile not found');
    }
    return profile;
  }

  async getMyChannel(userId: string) {
    const profile = await this.getCreatorProfile(userId);
    if (!profile.channel) {
      throw new NotFoundException('No channel created yet');
    }
    return profile.channel;
  }

  async createMyChannel(userId: string, dto: CreateChannelDto) {
    const profile = await this.getCreatorProfile(userId);
    if (profile.channel) {
      throw new ConflictException('A channel already exists for this creator');
    }
    const slug = dto.slug || this.slugify(dto.name);
    await this.ensureUniqueSlug(slug);

    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    return this.prisma.channel.create({
      data: {
        creatorId: profile.id,
        name: dto.name.trim(),
        slug,
        description: dto.description,
        logoUrl: dto.logoUrl,
        bannerUrl: dto.bannerUrl,
        websiteUrl: dto.websiteUrl,
        instagramUrl: dto.instagramUrl,
        youtubeUrl: dto.youtubeUrl,
        twitterUrl: dto.twitterUrl,
        categoryId: dto.categoryId,
      },
      include: { category: true },
    });
  }

  async updateMyChannel(userId: string, dto: UpdateChannelDto) {
    const profile = await this.getCreatorProfile(userId);
    if (!profile.channel) {
      throw new NotFoundException('No channel created yet');
    }

    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const data: any = { ...dto };
    const newName = dto.name?.trim();
    const nameChanged = !!newName && newName !== profile.channel.name;
    if (nameChanged && newName) {
      const slug = this.slugify(newName);
      await this.ensureUniqueSlug(slug, profile.channel.id);
      data.slug = slug;
    }

    return this.prisma.channel.update({
      where: { id: profile.channel.id },
      data,
      include: { category: true },
    });
  }

  private async assertCategoryExists(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new BadRequestException('Selected category does not exist');
    }
  }

  // ---- Admin endpoints ----

  async adminFindAll(query: PaginationQueryDto, isSuspended?: string) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();

    const where: any = {};
    if (isSuspended !== undefined) where.isSuspended = isSuspended === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        {
          creator: { user: { name: { contains: search, mode: 'insensitive' } } },
        },
        {
          creator: { user: { email: { contains: search, mode: 'insensitive' } } },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.channel.findMany({
        where,
        include: {
          category: true,
          creator: {
            include: {
              user: { select: { id: true, name: true, email: true, status: true } },
            },
          },
          _count: { select: { videos: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.channel.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async adminFindOne(id: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id },
      include: {
        category: true,
        creator: { include: { user: { select: { id: true, name: true, email: true, status: true } } } },
        _count: { select: { videos: true } },
      },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return channel;
  }

  async adminUpdateStatus(id: string, isSuspended: boolean) {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return this.prisma.channel.update({
      where: { id },
      data: { isSuspended },
      include: { category: true },
    });
  }
}
