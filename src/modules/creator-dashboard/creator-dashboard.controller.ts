import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CreatorDashboardService } from './creator-dashboard.service';
import { CreatorAnalyticsService } from './creator-analytics.service';

@Controller('creator')
@Roles(UserRole.CREATOR)
export class CreatorDashboardController {
  constructor(
    private readonly dashboard: CreatorDashboardService,
    private readonly analytics: CreatorAnalyticsService,
  ) {}

  /** GET /creator/dashboard — creator workflow stats + recent videos. */
  @Get('dashboard')
  getDashboard(@CurrentUser('id') userId: string) {
    return this.dashboard.getDashboard(userId);
  }

  /**
   * GET /creator/analytics — real engagement analytics computed from
   * existing social models (VideoLike, Comment, VideoShare, SavedVideo,
   * ChannelFollow, WatchHistory). No view counts; all metrics labeled
   * accurately. Creator-scoped: always derived from the authenticated user.
   */
  @Get('analytics')
  getAnalytics(@CurrentUser('id') userId: string) {
    return this.analytics.getAnalytics(userId);
  }
}
