import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CreatorDashboardService } from './creator-dashboard.service';

@Controller('creator/dashboard')
@Roles(UserRole.CREATOR)
export class CreatorDashboardController {
  constructor(private readonly dashboard: CreatorDashboardService) {}

  @Get()
  get(@CurrentUser('id') userId: string) {
    return this.dashboard.getDashboard(userId);
  }
}
