import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole, VideoStatus } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { VideosService, UploadSourceFile } from './videos.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { UploadVideoDto } from './dto/upload-video.dto';

/** Multer file shape produced by FileInterceptor. */
interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

@Controller('creator/videos')
@Roles(UserRole.CREATOR)
export class CreatorVideosController {
  constructor(private readonly videos: VideosService) {}

  @Get()
  list(@CurrentUser('id') userId: string, @Query('status') status?: VideoStatus) {
    return this.videos.listOwn(userId, status);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.videos.getOwn(userId, id);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateVideoDto) {
    return this.videos.createOwn(userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() dto: UpdateVideoDto) {
    return this.videos.updateOwn(userId, id, dto);
  }

  /**

   * Upload a real source file to an existing creator-owned video.
   * Multipart request: one `file` part + optional `title`/`description`/
   * `thumbnailUrl`/`categoryId`/`status` fields.
   */
  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body() dto: UploadVideoDto,
  ) {
    const sourceFile: UploadSourceFile | null = file
      ? {
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.buffer ? file.buffer.length : file.size,
          buffer: file.buffer ?? null,
        }
      : null;
    return this.videos.uploadSource(userId, id, sourceFile, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.videos.removeOwn(userId, id);
  }
}