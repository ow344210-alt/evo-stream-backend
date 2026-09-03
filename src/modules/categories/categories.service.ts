import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Category } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto): Promise<Category> {
    const slug = (dto.slug || dto.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const conflict = await this.prisma.category.findFirst({
      where: { OR: [{ name: dto.name }, { slug }] },
    });
    if (conflict) {
      throw new ConflictException('A category with this name or slug already exists');
    }

    return this.prisma.category.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description,
        icon: dto.icon,
        featured: dto.featured ?? false,
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
            { name: { contains: search, mode: 'insensitive' as const } },
            { slug: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        orderBy: [{ featured: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { videos: true } } },
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findActive(): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ featured: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { videos: true, channels: true } } },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.findOne(id);
    const data = { ...dto };
    if (dto.name || dto.slug) {
      const slug = (dto.slug || dto.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      data.slug = slug;
      const conflict = await this.prisma.category.findFirst({
        where: { AND: [{ slug }, { NOT: { id } }] },
      });
      if (conflict) {
        throw new ConflictException('A category with this slug already exists');
      }
    }
    return this.prisma.category.update({ where: { id }, data });
  }

  async remove(id: string): Promise<{ message: string }> {
    await this.findOne(id);
    // Channels/videos referencing this category keep their categoryId but it
    // becomes effectively uncategorized since the category row is removed.
    await this.prisma.$transaction([
      this.prisma.channel.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
      this.prisma.video.updateMany({ where: { categoryId: id }, data: { categoryId: null } }),
    ]);
    await this.prisma.category.delete({ where: { id } });
    return { message: 'Category removed' };
  }
}
