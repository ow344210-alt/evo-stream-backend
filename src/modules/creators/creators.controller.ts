import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CreatorsService } from './creators.service';
import { UpdateUserStatusDto } from '../users/dto/update-user-status.dto';
import { UpdateCreatorVerificationDto } from './dto/update-creator-verification.dto';

@Controller('admin/creators')
@Roles(UserRole.ADMIN)
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: UserStatus,
    @Query('verified') verified?: string,
  ) {
    return this.creators.findAll({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      status,
      verified,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.creators.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.creators.updateStatus(id, dto, actorId);
  }

  @Patch(':id/verification')
  updateVerification(
    @Param('id') id: string,
    @Body() dto: UpdateCreatorVerificationDto,
  ) {
    return this.creators.updateVerification(id, dto);
  }
}
