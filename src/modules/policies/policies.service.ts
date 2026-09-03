import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformPolicy } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePolicyDto): Promise<PlatformPolicy> {
    const existing = await this.prisma.platformPolicy.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException('A policy with this slug already exists');
    }
    return this.prisma.platformPolicy.create({
      data: {
        title: dto.title.trim(),
        slug: dto.slug,
        content: dto.content,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();

    const where = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.platformPolicy.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.platformPolicy.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findActive(): Promise<PlatformPolicy[]> {
    return this.prisma.platformPolicy.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<PlatformPolicy> {
    const policy = await this.prisma.platformPolicy.findUnique({ where: { id } });
    if (!policy) {
      throw new NotFoundException('Policy not found');
    }
    return policy;
  }

  async update(id: string, dto: UpdatePolicyDto): Promise<PlatformPolicy> {
    await this.findOne(id);
    return this.prisma.platformPolicy.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<{ message: string }> {
    await this.findOne(id);
    await this.prisma.platformPolicy.delete({ where: { id } });
    return { message: 'Policy removed' };
  }
}
