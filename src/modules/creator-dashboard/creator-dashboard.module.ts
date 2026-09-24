import { Module } from '@nestjs/common';
import { CreatorDashboardController } from './creator-dashboard.controller';
import { CreatorDashboardService } from './creator-dashboard.service';
import { CreatorAnalyticsService } from './creator-analytics.service';

@Module({
  controllers: [CreatorDashboardController],
  providers: [CreatorDashboardService, CreatorAnalyticsService],
  exports: [CreatorDashboardService, CreatorAnalyticsService],
})
export class CreatorDashboardModule {}

