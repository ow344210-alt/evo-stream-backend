import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class RecordProgressDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  positionSeconds?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  progressPercent?: number = 0;
}
