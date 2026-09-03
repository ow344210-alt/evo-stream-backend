import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { TranscodeRenditionSpec } from './video-transcoding.types';

const DEFAULT_FFMPEG = 'ffmpeg';
const DEFAULT_FFPROBE = 'ffprobe';
const DEFAULT_POSTER_AT_SECONDS = 5;

/**
 * Default adaptive ladder for HLS mastering (H.264/AAC).
 */
const DEFAULT_LADDER: TranscodeRenditionSpec[] = [
  { label: '360p', height: 360, videoBitrate: 450e3, audioBitrate: 96e3, width: 640 },
  { label: '480p', height: 480, videoBitrate: 800e3, audioBitrate: 128e3, width: 854 },
  { label: '720p', height: 720, videoBitrate: 1500e3, audioBitrate: 128e3, width: 1280 },
  { label: '1080p', height: 1080, videoBitrate: 2800e3, audioBitrate: 192e3, width: 1920 },
];

/**
 * Environment-driven transcoding configuration. Constructed on startup so an
 * explicitly-selected production transcoder that is not installed fails fast
 * with a clear message rather than half-way through a processing job.
 */
@Injectable()
export class VideoTranscodeConfig {
  private readonly logger = new Logger(VideoTranscodeConfig.name);

  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly renditions: readonly TranscodeRenditionSpec[];
  readonly posterAtSeconds: number;
  /** Require the binaries to resolve at startup so misconfiguration is loud. */
  readonly requireBinaries: boolean;

  constructor(private readonly config: ConfigService) {
    this.ffmpegPath = this.config.get<string>('FFMPEG_PATH') ?? DEFAULT_FFMPEG;
    this.ffprobePath = this.config.get<string>('FFPROBE_PATH') ?? DEFAULT_FFPROBE;
    this.renditions = this.parseLadder(this.config.get<string>('VIDEO_TRANSCODE_LADDER'));
    this.posterAtSeconds = this.parsePosterAt(this.config.get<string>('VIDEO_POSTER_AT_SEC'));
    this.requireBinaries = (this.config.get<string>('VIDEO_TRANSCODE_REQUIRE_BIN') ?? 'false') === 'true';

    // When requireBinaries is true, validate at boot so misconfiguration is
    // loud. Default is lazy (false): the app boots even without FFmpeg, and any
    // processing job marks the video FAILED with a clear message instead of
    // crashing the process.

    this.logger.log(
      `Video transcoding initialised: ffmpeg=${this.ffmpegPath}, ladder=[${this.renditions
        .map((r) => r.label)
        .join(', ')}], posterAt=${this.posterAtSeconds}s`,
    );
  }

  private parseLadder(raw: string | undefined): TranscodeRenditionSpec[] {
    if (!raw || raw.trim() === '') return DEFAULT_LADDER;
    // e.g. "360p:450:96,720p:1500:128" -> label:videoKbps:audioKbps
    const tiers = raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tiers.length === 0) return DEFAULT_LADDER;
    return tiers.map((tier) => {
      const [label, videoKbps, audioKbps, height] = tier.split(':');
      const v = Number(videoKbps);
      const a = Number(audioKbps);
      if (!label || !Number.isFinite(v) || !Number.isFinite(a)) {
        throw new Error(`Invalid VIDEO_TRANSCODE_LADDER tier "${tier}"`);
      }
      return { label, videoBitrate: v * 1000, audioBitrate: a * 1000, height: Number(height) || undefined };
    });
  }

  private parsePosterAt(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === '') return DEFAULT_POSTER_AT_SECONDS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_POSTER_AT_SECONDS;
    return n;
  }

  /** Resolve the configured FFmpeg executable to an absolute path, or null. */
  resolveFfmpeg(): string | null {
    return this.resolveOnPath(this.ffmpegPath);
  }

  /** Resolve the configured FFprobe executable to an absolute path, or null. */
  resolveFfprobe(): string | null {
    return this.resolveOnPath(this.ffprobePath);
  }

  private resolveOnPath(bin: string): string | null {
    if (bin.includes('/') || bin.includes('\\')) {
      return fs.existsSync(bin) ? bin : null;
    }
    const exts: string[] = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    const dirs = (process.env.PATH ?? '').split(path.delimiter);
    for (const dir of dirs) {
      if (!dir) continue;
      for (const ext of exts) {
        const candidate = path.join(dir, `${bin}${ext}`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  }
}