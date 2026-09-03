import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { VideoPlaybackService } from './video-playback.service';

/**
 * Public video playback and metadata endpoints.
 *
 * Routes:
 *   GET /api/videos/:id/playback  — Full playback metadata for a video
 *   GET /api/videos/:id           — Minimal public video read
 *
 * These endpoints are public because viewers need to retrieve playback
 * information without authentication. Eligibility is enforced internally:
 * only READY + PUBLISHED videos expose streamable media URLs.
 */
@Controller('videos')
export class VideoPlaybackController {
  constructor(private readonly playback: VideoPlaybackService) {}

  /**
   * Full playback metadata for a video. Returns HLS master URL, poster,
   * duration, available qualities, and channel info. Only succeeds for
   * READY + PUBLISHED videos.
   */
  @Get(':id/playback')
  @Public()
  getPlayback(@Param('id') id: string) {
    return this.playback.getPublicPlaybackMetadata(id);
  }

  /**
   * Minimal public video read. Returns basic video information without
   * exposing internal processing or storage details. Useful for video
   * detail pages before the player is initialized.
   */
  @Get(':id')
  @Public()
  getPublicVideo(@Param('id') id: string) {
    return this.playback.getPublicPlaybackMetadata(id);
  }
}
