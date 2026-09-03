import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { VideoStatus } from '@prisma/client';

/**
 * Optional metadata accepted alongside a source-file upload to an existing
 * creator video. All fields are optional so an upload can attach a file to a
 * video that was already created as a metadata-only draft, or edit title /
 * category / thumbnail in the same request.
 */
export class UploadVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @IsOptional()
  @IsEnum(VideoStatus)
  status?: VideoStatus;

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;
}