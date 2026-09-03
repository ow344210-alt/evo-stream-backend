import { Module } from '@nestjs/common';
import { PublicFeedController } from './public-feed.controller';
import { PublicFeedService } from './public-feed.service';

/**
 * Public discovery feed module (P2-9).
 *
 * Provides the minimal public read API consumed by the Phase-2 mobile app:
 * latest, trending, category filter, and search — all READY + PUBLISHED-only,
 * safely serialized, and paginated. No Phase-3 recommendation infrastructure.
 */
@Module({
  controllers: [PublicFeedController],
  providers: [PublicFeedService],
  exports: [PublicFeedService],
})
export class PublicFeedModule {}
