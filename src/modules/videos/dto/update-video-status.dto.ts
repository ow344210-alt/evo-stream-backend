import { IsEnum } from 'class-validator';
import { VideoStatus } from '@prisma/client';

export class UpdateVideoStatusDto {
  @IsEnum(VideoStatus)
  status: VideoStatus;
}
