import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePolicyDto {
  @IsString()
  @MaxLength(160)
  title: string;

  @IsString()
  @MaxLength(160)
  slug: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
