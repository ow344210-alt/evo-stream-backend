import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { Paginated } from '../../common/dto/pagination.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { PublicFeedService, PublicVideoCard } from './public-feed.service';

/**
 * Public discovery feed (P2-9).
 *
 * These are the minimum public read endpoints the Phase-2 mobile app needs to
 * make Home / Latest / Trending / Categories / Search functional. Everything is
 * READY + PUBLISHED-only, serialized safely, and paginated.
 *
 * Routes (all public):
 *   GET /api/feed                  -> latest (default feed)
 *   GET /api/feed/latest           -> latest
 *   GET /api/feed/trending         -> MVP deterministic trending
 *   GET /api/feed/search?q=...     -> title / channel search
 *   GET /api/feed?category=...     -> filter latest by category (id or slug)
 *   GET /api/feed/latest?category=...
 */
@Controller('feed')
export class PublicFeedController {
  constructor(private readonly feed: PublicFeedService) {}

  @Get()
  @Public()
  default(@Query() query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    return this.feed.latest(query);
  }

  @Get('latest')
  @Public()
  latest(@Query() query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    return this.feed.latest(query);
  }

  @Get('trending')
  @Public()
  trending(@Query() query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    return this.feed.trending(query);
  }

  @Get('search')
  @Public()
  search(@Query() query: FeedQueryDto): Promise<Paginated<PublicVideoCard>> {
    return this.feed.search(query);
  }
}
