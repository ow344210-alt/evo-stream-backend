import { Module } from '@nestjs/common';
import { CreatorDashboardController } from './creator-dashboard.controller';
import { CreatorDashboardService } from './creator-dashboard.service';

@Module({
  controllers: [CreatorDashboardController],
  providers: [CreatorDashboardService],
  exports: [CreatorDashboardService],
})
export class CreatorDashboardModule {}
