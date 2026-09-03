import { IsBoolean } from 'class-validator';

export class UpdateCreatorVerificationDto {
  @IsBoolean()
  isVerified: boolean;
}
