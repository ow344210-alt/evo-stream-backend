import { IsBoolean } from 'class-validator';

export class UpdateChannelStatusDto {
  @IsBoolean()
  isSuspended: boolean;
}
