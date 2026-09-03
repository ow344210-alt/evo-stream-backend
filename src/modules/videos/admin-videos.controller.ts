import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { UserRole, VideoStatus } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { VideosService } from './videos.service';
import { UpdateVideoStatusDto } from './dto/update-video-status.dto';

@Controller('admin/videos')
@Roles(UserRole.ADMIN)
export class AdminVideosController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: VideoStatus,
  ) {
    return this.videos.adminFindAll(
      { page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined, search },
      status,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.videos.adminFindOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateVideoStatusDto) {
    return this.videos.adminUpdateStatus(id, dto.status);
  }
}
