import { Injectable, Logger } from '@nestjs/common';
import { VideoStorageConfig } from '../video-storage/video-storage.config';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { resolveWithin } from '../video-storage/storage-path.util';

const HLS_MIME_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const ALL_MIME_TYPES: Record<string, string> = {
  ...HLS_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
};

/**
 * Serves media assets (HLS playlists, segments, thumbnails) from local storage.
 *
 * Security invariants:
 * - Only files under a validated video's HLS/thumbnail directory are served.
 * - Path traversal is rejected via resolveWithin.
 * - Only expected MIME types are served.
 * - The entire local filesystem is never exposed.
 */
@Injectable()
export class VideoMediaService {
  private readonly logger = new Logger(VideoMediaService.name);

  constructor(private readonly storageConfig: VideoStorageConfig) {}

  /**
   * Resolve a media path to an absolute filesystem path if it belongs to a
   * valid processed video. Returns the absolute path and MIME type, or null
   * if the key does not resolve to a valid file.
   */
  async resolveMediaPath(
    videoId: string,
    relativePath: string,
  ): Promise<{ absolutePath: string; mimeType: string; size: number } | null> {
    if (!this.storageConfig.localStoragePath) return null;

    const root = path.resolve(this.storageConfig.localStoragePath);
    const safeKey = `videos/${videoId}/${relativePath}`;

    let absolutePath: string;
    try {
      absolutePath = resolveWithin(root, safeKey);
    } catch {
      return null;
    }

    // Verify the resolved path is still under root (defence in depth).
    if (!absolutePath.startsWith(root + path.sep) && absolutePath !== root) {
      return null;
    }

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(absolutePath);
    } catch {
      return null;
    }

    if (!stat.isFile()) return null;

    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = ALL_MIME_TYPES[ext];
    if (!mimeType) return null;

    return { absolutePath, mimeType, size: stat.size };
  }

  /**
   * Create a readable stream for a resolved media file. Uses file-based
   * streaming so large segments are not loaded into memory.
   */
  createReadStream(absolutePath: string, start?: number, end?: number): fs.ReadStream {
    return fs.createReadStream(absolutePath, { start, end });
  }
}
