import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListCommentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
