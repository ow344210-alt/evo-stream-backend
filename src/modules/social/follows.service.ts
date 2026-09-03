import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Channel follow/unfollow. One follow per (user, channel) enforced by a
 * compound unique constraint. A channel must exist to be followed.
 */
@Injectable()
export class FollowsService {
  constructor(private readonly prisma: PrismaService) {}

  async follow(userId: string, channelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const existing = await this.prisma.channelFollow.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });
    if (!existing) {
      await this.prisma.channelFollow.create({ data: { userId, channelId } });
    }

    const followerCount = await this.prisma.channelFollow.count({
      where: { channelId },
    });
    return { following: true, channel: { id: channel.id, name: channel.name, slug: channel.slug }, followerCount };
  }

  async unfollow(userId: string, channelId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
    });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const existing = await this.prisma.channelFollow.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });
    if (existing) {
      await this.prisma.channelFollow.delete({ where: { id: existing.id } });
    }

    const followerCount = await this.prisma.channelFollow.count({
      where: { channelId },
    });
    return { following: false, followerCount };
  }

  async getFollowing(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.channelFollow.findMany({
        where,
        include: {
          channel: { select: { id: true, name: true, slug: true, description: true, logoUrl: true } },
        },
        orderBy: { followedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.channelFollow.count({ where }),
    ]);

    return {
      items: rows.map((row) => row.channel),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
