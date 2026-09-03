import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ChannelsService } from './channels.service';
import { UpdateChannelStatusDto } from './dto/update-channel-status.dto';

@Controller('admin/channels')
@Roles(UserRole.ADMIN)
export class AdminChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('isSuspended') isSuspended?: string,
  ) {
    return this.channels.adminFindAll(
      {
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        search,
      },
      isSuspended,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.channels.adminFindOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateChannelStatusDto) {
    return this.channels.adminUpdateStatus(id, dto.isSuspended);
  }
}
