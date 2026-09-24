import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class RecordViewDto {
  /**
   * Persistent anonymous client/installation ID (UUIDv4).
   * Used exclusively for anonymous sessions to maintain stable rolling deduplication.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionToken?: string;

  /**
   * Consumed media duration in seconds actively watched on the timeline
   * (scaled by playback rate, excluding seeks, buffering, pauses, and background).
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(86400)
  watchDurationSeconds?: number;
}
