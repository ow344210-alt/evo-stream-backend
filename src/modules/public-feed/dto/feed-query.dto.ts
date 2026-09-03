import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * Public discovery/feed query parameters (P2-9).
 *
 * Extends the shared pagination DTO (page/pageSize/search) and adds an optional
 * `category` filter (by category id or slug). Used by the public feed, latest,
 * trending and search endpoints. `whitelist:true` + `forbidNonWhitelisted:true`
 * on the global ValidationPipe mean only these keys are accepted.
 */
export class FeedQueryDto extends PaginationQueryDto {
  /** Category id or slug to narrow the feed to a single category. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  /** Free-text search over video title and channel name. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
