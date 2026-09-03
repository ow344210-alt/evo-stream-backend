import { Module } from '@nestjs/common';
import { VideoMediaController } from './video-media.controller';
import { VideoPlaybackController } from './video-playback.controller';
import { VideoMediaService } from './video-media.service';
import { VideoPlaybackService } from './video-playback.service';

/**
 * Video playback module (P2-5).
 *
 * Provides:
 * - Media delivery: safe serving of HLS playlists, segments, and thumbnails
 *   from local storage with path-traversal protection and correct MIME types.
 * - Playback metadata: structured API response with HLS master URL, poster,
 *   duration, available qualities, and channel info.
 * - Public video read: minimal public endpoint for viewer access.
 *
 * The module depends on VideoStorageConfig (from VideoStorageModule) for the
 * local storage root path, and on PrismaService for video/rendition queries.
 */
@Module({
  controllers: [VideoMediaController, VideoPlaybackController],
  providers: [VideoMediaService, VideoPlaybackService],
  exports: [VideoPlaybackService],
})
export class VideoPlaybackModule {}
