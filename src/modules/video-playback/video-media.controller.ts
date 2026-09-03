import {
  Controller,
  Get,
  Header,
  Logger,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { VideoMediaService } from './video-media.service';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Serves media assets (HLS playlists, segments, thumbnails) for processed videos.
 *
 * Route: /api/media/:videoId/*  (catch-all underneath a video)
 *
 * Security:
 * - Only files belonging to a valid video ID are served.
 * - Path traversal is rejected by resolveWithin in VideoMediaService.
 * - Only expected MIME types (.m3u8, .ts, .jpg, .png) are served.
 * - The entire backend filesystem is never exposed.
 *
 * All routes are public because HLS segments/playlists must be fetchable
 * by the browser player without authentication. Playback eligibility is
 * enforced at the playback metadata level (only READY+PUBLISHED videos
 * expose their media URLs).
 */
@Controller('media')
export class VideoMediaController {
  private readonly logger = new Logger(VideoMediaController.name);

  constructor(private readonly mediaService: VideoMediaService) {}

  /**
   * Serve any media file belonging to a video. The :videoId param pins access
   * to that video's storage directory; the remaining URL path is the relative
   * media key (e.g. `hls/master.m3u8`).
   */
  @Get(':videoId/*splat')
  @Public()
  @Header('Access-Control-Allow-Origin', '*')
  async serveMedia(
    @Param('videoId') videoId: string,
    @Param('splat') splat: string[],
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    // Basic UUID format validation for videoId.
    if (!/^[0-9a-f-]{36}$/i.test(videoId)) {
      throw new NotFoundException('Invalid video ID');
    }

    // Express 5 captures the catch-all `*splat` as an array of path segments;
    // join them back into the relative media key (e.g. "hls/master.m3u8").
    const relativePath = Array.isArray(splat) ? splat.join('/') : (splat ?? '');
    if (!relativePath) {
      throw new NotFoundException('Media not found');
    }

    const resolved = await this.mediaService.resolveMediaPath(videoId, relativePath);
    if (!resolved) {
      throw new NotFoundException('Media not found');
    }

    // Set CORS headers for cross-origin HLS requests.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Handle HEAD requests (useful for player probing).
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', resolved.mimeType);
      res.setHeader('Content-Length', resolved.size);
      res.statusCode = 200;
      res.end();
      return;
    }

    // Handle range requests for video segments.
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, resolved.size - 1);
      const chunkSize = end - start + 1;

      res.setHeader('Content-Range', `bytes ${start}-${end}/${resolved.size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', resolved.mimeType);
      res.statusCode = 206;

      const stream = this.mediaService.createReadStream(resolved.absolutePath, start, end);
      stream.pipe(res);
      stream.on('error', (err) => {
        this.logger.error(`Error streaming media: ${err.message}`);
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end();
        }
      });
      return;
    }

    // Standard full-file response.
    res.setHeader('Content-Type', resolved.mimeType);
    res.setHeader('Content-Length', resolved.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.statusCode = 200;

    const stream = this.mediaService.createReadStream(resolved.absolutePath);
    stream.pipe(res);
    stream.on('error', (err) => {
      this.logger.error(`Error streaming media: ${err.message}`);
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end();
      }
    });
  }
}
