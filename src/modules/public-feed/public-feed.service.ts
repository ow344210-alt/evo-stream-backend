import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  VideoProcessingStatus,
  VideoStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Paginated } from '../../common/dto/pagination.dto';
import { FeedQueryDto } from './dto/feed-query.dto';

/**
 * Safe, minimal public video card returned by the Phase-2 mobile discovery
 * feed. Never exposes storage keys, filesystem paths, process errors, or
 * internal processing data.
 */
export interface PublicVideoCard {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  posterUrl: string | null;
  publishedAt: string | null;
  channel: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
}

/**
 * Public discovery feed for the Phase-2 mobile app (P2-9).
 *
 * Purpose: give the mobile app the MINIMUM read API it needs (latest,
 * trending, category filter, search) without building Phase-3 discovery
 * infrastructure. Everything is a simple, deterministic MVP:
 *   - latest  -> eligible videos ordered by publishedAt DESC
 *   - trending-> deterministic engagement + recency score
 *   - category-> eligible videos for one category
 *   - search  -> case-insensitive title / channel-name match
 *
 * Only READY + PUBLISHED videos are ever returned (single eligibility source,
 * mirroring playback). Responses are paginated with the shared `Paginated<T>`
 * shape and serialized through `PublicVideoCard`.
 */
@Injectable()
export class PublicFeedService {
  constructor(private readonly prisma: PrismaService) {}

  /** MVP trending window: a video's recency weight is based on this many days. */
  private static readonly TRENDING_WINDOW_DAYS = 30;
  /** Engagement weights for the deterministic MVP trending score. */
  private static readonly WEIGHT = { like: 1, comment: 2, share: 3, recency: 0.5 };

  private readonly eligibleWhere: Prisma.VideoWhereInput = {
    status: VideoStatus.PUBLISHED,
    processingStatus: VideoProcessingStatus.READY,
  };

  /** Default feed order: newest published first, newest created as a stable tiebreaker. */
  private static readonly FEED_ORDER: Prisma.VideoOrderByWithRelationInput[] = [
    { publishedAt: 'desc' },
    { createdAt: 'desc' },
  ];

  /**
   * Default feed: the latest eligible videos (publishedAt DESC, createdAt
   * DESC as a stable tiebreaker). Equivalently the "Latest" feed.
   */
  latest(query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    return this.listEligible(query, PublicFeedService.FEED_ORDER);
  }

  /**
   * MVP Trending.
   *
   * Deterministic score, deliberately simple (Phase 3 owns recommendations):
   *   score = likeCount*1 + commentCount*2 + shareCount*3
   *           + recencyWeight * (1 - daysSincePublish / window)
   *
   * Videos beyond the window still get their engagement weight but no recency
   * boost. This is NOT machine learning. The eligible set is fetched (bounded),
   * scored in memory, sorted desc, then paginated.
   */
  async trending(query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    const rows = await this.prisma.video.findMany({
      where: this.eligibleWhere,
      include: {
        channel: { select: { id: true, name: true, slug: true } },
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { likes: true, comments: true, shares: true } },
      },
      take: 500,
    });

    const scored = rows
      .map((v) => {
        const days = v.publishedAt
          ? Math.max(0, (Date.now() - v.publishedAt.getTime()) / 86_400_000)
          : PublicFeedService.TRENDING_WINDOW_DAYS;
        const recency = days <= PublicFeedService.TRENDING_WINDOW_DAYS
          ? (1 - days / PublicFeedService.TRENDING_WINDOW_DAYS)
          : 0;
        const score =
          v._count.likes * PublicFeedService.WEIGHT.like +
          v._count.comments * PublicFeedService.WEIGHT.comment +
          v._count.shares * PublicFeedService.WEIGHT.share +
          recency * PublicFeedService.WEIGHT.recency;
        return { video: v, score };
      })
      .sort((a, b) => b.score - a.score || b.video.publishedAt!.getTime() - a.video.publishedAt!.getTime());

    const base = scored.map((s) => this.serialize(s.video));
    return this.paginate(base, query.page ?? 1, query.pageSize ?? 20, base.length);
  }

  /**
   * Eligible videos belonging to a category (id or slug). 404 if the category
   * does not exist. Uses the same public eligibility rule.
   */
  async byCategory(query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    const category = await this.resolveCategory(query.category);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return this.countedPage(
      { ...this.eligibleWhere, categoryId: category.id },
      PublicFeedService.FEED_ORDER,
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  }

  /**
   * Search over eligible video titles and channel names. Uses PostgreSQL
   * case-insensitive contains matching — no external search service (Phase 3
   * owns full-text/discovery). Empty/blank query returns an empty page.
   */
  async search(query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    const q = (query.q ?? '').trim();
    if (!q) {
      return this.paginate([], query.page ?? 1, query.pageSize ?? 20, 0);
    }
    const where: Prisma.VideoWhereInput = {
      ...this.eligibleWhere,
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { channel: { name: { contains: q, mode: 'insensitive' } } },
      ],
    };
    return this.countedPage(where, PublicFeedService.FEED_ORDER, query.page ?? 1, query.pageSize ?? 20);
  }

  private async resolveCategory(ref?: string) {
    if (!ref) return null;
    return (
      (await this.prisma.category.findFirst({ where: { slug: ref } })) ??
      (await this.prisma.category.findUnique({ where: { id: ref } }))
    );
  }

  private async listEligible(
    query: FeedQueryDto,
    orderBy: Prisma.VideoOrderByWithRelationInput[],
  ): Promise<Paginated<PublicVideoCard>> {
    const where: Prisma.VideoWhereInput = { ...this.eligibleWhere };
    const category = query.category ? await this.resolveCategory(query.category) : undefined;
    if (query.category && !category) {
      throw new NotFoundException('Category not found');
    }
    if (category) where.categoryId = category.id;
    return this.countedPage(where, orderBy, query.page ?? 1, query.pageSize ?? 20);
  }

  private async countedPage(
    where: Prisma.VideoWhereInput,
    orderBy: Prisma.VideoOrderByWithRelationInput[],
    page: number,
    pageSize: number,
  ): Promise<Paginated<PublicVideoCard>> {
    const [rows, total] = await Promise.all([
      this.prisma.video.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: { select: { id: true, name: true, slug: true } },
          category: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.video.count({ where }),
    ]);
    return this.paginate(rows.map((r) => this.serialize(r)), page, pageSize, total);
  }

  private paginate(items: PublicVideoCard[], page: number, pageSize: number, total: number): Paginated<PublicVideoCard> {
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  private serialize(video: {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number | null;
    posterThumbnailKey: string | null;
    publishedAt: Date | null;
    channel: { id: string; name: string; slug: string } | null;
    category: { id: string; name: string; slug: string } | null;
  }): PublicVideoCard {
    return {
      id: video.id,
      title: video.title,
      description: video.description,
      durationSeconds: video.durationSeconds,
      posterUrl: video.posterThumbnailKey
        ? `/api/media/${video.id}/${this.stripVideoPrefix(video.posterThumbnailKey)}`
        : null,
      publishedAt: video.publishedAt?.toISOString() ?? null,
      channel: video.channel,
      category: video.category,
    };
  }

  private stripVideoPrefix(storageKey: string): string {
    const parts = storageKey.split('/');
    if (parts.length >= 3 && parts[0] === 'videos') {
      return parts.slice(2).join('/');
    }
    return storageKey;
  }
}
