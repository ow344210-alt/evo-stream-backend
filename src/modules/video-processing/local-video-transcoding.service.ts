import { Injectable, Inject, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  TranscodeOptions,
  TranscodeRenditionResult,
  TranscodeResult,
  VideoTranscodingProvider,
  TranscodeRenditionSpec,
} from './video-transcoding.types';
import { VideoTranscodeConfig } from './video-transcode.config';
import { VideoStorageConfig } from '../video-storage/video-storage.config';
import {
  VIDEO_STORAGE_PROVIDER,
  type VideoStorageProvider,
} from '../video-storage/video-storage.types';
import { resolveWithin } from '../video-storage/storage-path.util';

const execFileAsync = promisify(execFile);

/**
 * Bounds for FFmpeg/Ffprobe child processes. Long-form content is explicitly
 * supported, so transcode jobs get a duration-aware ceiling rather than a fixed
 * short cap. A timed-out child is killed (SIGKILL) and the resulting error
 * propagates so the processing layer marks the video FAILED instead of leaving
 * it stuck in PROCESSING.
 */
const FFPROBE_TIMEOUT_MS = 30 * 1000;
const FFMPEG_TIMEOUT_MIN_MS = 15 * 60 * 1000;
/** Wall-clock seconds allowed per second of source media. */
const FFMPEG_TIMEOUT_MULTIPLIER = 5;
const FFMPEG_TIMEOUT_MAX_MS = 3 * 60 * 60 * 1000;

/**
 * FFmpeg-backed transcoder. Produces an adaptive HLS ladder plus a poster
 * thumbnail.
 *
 * With the `local` storage provider, output is written directly under the
 * local storage root so the catalogued provider-relative keys stay stable and
 * storage-consistent.
 *
 * With a remote provider (e.g. `bunny`), the source object is read through the
 * storage abstraction into a temporary local workspace, FFmpeg produces the
 * tree there, and the returned `outputRoot` hands the tree to the processing
 * layer for publishing to the active provider. The workspace is removed on any
 * failure here (and by the processing layer after a successful publish).
 *
 * FFmpeg/Ffprobe are resolved via PATH (or FFMPEG_PATH/FFPROBE_PATH). When they
 * are unavailable the job throws a descriptive error that the processing layer
 * maps to a FAILED processing status — it never crashes the process.
 */
@Injectable()
export class LocalVideoTranscodingService implements VideoTranscodingProvider {
  readonly name = 'local-ffmpeg';
  private readonly logger = new Logger(LocalVideoTranscodingService.name);

  constructor(
    private readonly storageConfig: VideoStorageConfig,
    private readonly transcodeConfig: VideoTranscodeConfig,
    @Inject(VIDEO_STORAGE_PROVIDER) private readonly storage: VideoStorageProvider,
  ) {}

  /** Fixed ceiling for the cheap duration probe. */
  private probeTimeoutMs(): number {
    return FFPROBE_TIMEOUT_MS;
  }

  /**
   * Duration-aware ceiling for one rendition encode. Bounded below by
   * `FFMPEG_TIMEOUT_MIN_MS`, above by `FFMPEG_TIMEOUT_MAX_MS`, and scaled by the
   * source duration so legitimate long-form videos are not killed mid-encode.
   */
  private renditionTimeoutMs(durationSeconds: number): number {
    const computed = durationSeconds * FFMPEG_TIMEOUT_MULTIPLIER * 1000;
    return Math.min(FFMPEG_TIMEOUT_MAX_MS, Math.max(FFMPEG_TIMEOUT_MIN_MS, computed));
  }

  private execOptions(timeoutMs: number) {
    return {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: 'SIGKILL' as const,
    };
  }

  async transcode(
    options: TranscodeOptions & {
      renditions: TranscodeRenditionSpec[];
      posterAtSeconds?: number;
    },
  ): Promise<TranscodeResult> {
    const ffmpeg = this.transcodeConfig.resolveFfmpeg();
    const ffprobe = this.transcodeConfig.resolveFfprobe();
    if (!ffmpeg || !ffprobe) {
      throw new Error(
        'FFmpeg/Ffprobe are not available. Install FFmpeg or set FFMPEG_PATH/FFPROBE_PATH to process videos.',
      );
    }

    const writesToLocalRoot = this.storage.name === 'local';
    if (writesToLocalRoot && !this.storageConfig.localStoragePath) {
      throw new Error('Local transcoding requires the local storage provider (VIDEO_STORAGE_PROVIDER=local).');
    }

    // Resolve/clone the source into a local path FFmpeg can read, and decide
    // where the output tree is written.
    let sourceAbs: string;
    let outputPrefixAbs: string;
    let thumbPrefixAbs: string;
    let scratchRoot: string | undefined;

    if (writesToLocalRoot) {
      const root = path.resolve(this.storageConfig.localStoragePath);
      sourceAbs = resolveWithin(root, options.sourceKey);
      if (!fs.existsSync(sourceAbs)) {
        throw new Error(`Source object not found at ${options.sourceKey}`);
      }
      outputPrefixAbs = resolveWithin(root, options.outputPrefix);
      thumbPrefixAbs = resolveWithin(root, options.thumbnailPrefix);
    } else {
      scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-transcode-'));
      try {
        this.logger.log(`Source download started: ${options.sourceKey}`);
        const sourceBytes = await this.storage.read(options.sourceKey);
        sourceAbs = path.join(scratchRoot, 'source');
        await fsp.writeFile(sourceAbs, sourceBytes);
        this.logger.log(`Source download completed (${sourceBytes.length} bytes)`);
      } catch (error) {
        await fsp.rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      outputPrefixAbs = path.join(scratchRoot, ...options.outputPrefix.split('/'));
      thumbPrefixAbs = path.join(scratchRoot, ...options.thumbnailPrefix.split('/'));
    }

    this.logger.log(`Transcoding workspace ready for ${options.outputPrefix}`);

    try {
      const duration = await this.probeDuration(ffprobe, sourceAbs);
      this.logger.log(`ffprobe completed: duration=${duration}s`);

      const renditions: TranscodeRenditionResult[] = [];
      for (const spec of options.renditions) {
        this.logger.log(`Rendition ${spec.label} started`);
        renditions.push(
          await this.makeRendition(ffmpeg, sourceAbs, outputPrefixAbs, options.outputPrefix, spec, duration),
        );
        this.logger.log(`Rendition ${spec.label} completed`);
      }

      const posterAt = options.posterAtSeconds ?? 0;
      this.logger.log(`Poster generation started (t=${posterAt}s)`);
      const thumbKeys = await this.makeThumbnails(
        ffmpeg,
        sourceAbs,
        thumbPrefixAbs,
        options.thumbnailPrefix,
        posterAt,
      );
      this.logger.log(`Poster generation completed`);

      const masterKey = await this.writeMasterPlaylist(
        outputPrefixAbs,
        options.outputPrefix,
        renditions,
      );
      this.logger.log(`Master playlist generated: ${masterKey}`);

      return {
        renditions,
        thumbnails: thumbKeys,
        masterPlaylistKey: masterKey,
        durationSeconds: duration,
        outputRoot: writesToLocalRoot ? undefined : scratchRoot,
      };
    } catch (error) {
      if (scratchRoot) {
        await fsp.rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async probeDuration(ffprobe: string, sourceAbs: string): Promise<number> {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        sourceAbs,
      ],
      { ...this.execOptions(this.probeTimeoutMs()) },
    );
    const value = parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : 0;
  }

  private async makeRendition(
    ffmpeg: string,
    sourceAbs: string,
    outputPrefixAbs: string,
    outputPrefixKey: string,
    spec: TranscodeRenditionSpec,
    durationSeconds: number,
  ): Promise<TranscodeRenditionResult> {
    const rDir = path.join(outputPrefixAbs, spec.label);
    await fsp.mkdir(rDir, { recursive: true });

    const videoArgs = spec.videoBitrate > 0 ? ['-b:v', String(spec.videoBitrate), '-maxrate', String(spec.videoBitrate), '-bufsize', String(spec.videoBitrate * 2)] : [];
    const vf = spec.width && spec.height ? ['-vf', `scale=w=${spec.width}:h=${spec.height}:force_original_aspect_ratio=decrease,pad=w=${spec.width}:h=${spec.height}:x=(ow-iw)/2:y=(oh-ih)/2`] : [];
    const audioArgs = spec.audioBitrate > 0 ? ['-b:a', String(spec.audioBitrate)] : [];

    const args = [
      '-y',
      '-i', sourceAbs,
      ...videoArgs,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-g', '48',
      '-sc_threshold', '0',
      ...vf,
      '-c:a', 'aac',
      ...audioArgs,
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(rDir, 'segment_%04d.ts'),
      path.join(rDir, 'index.m3u8'),
    ];

    await execFileAsync(ffmpeg, args, this.execOptions(this.renditionTimeoutMs(durationSeconds)));
    // ffmpeg logs to stderr; a large log is expected, only non-zero exit throws.

    const height = spec.height ?? 720;
    const width = spec.width ?? Math.round((height * 16) / 9);
    const codec = 'h264';

    return {
      label: spec.label,
      height,
      width,
      bitrateKbps: Math.round(spec.videoBitrate / 1000),
      codec,
      segmentPrefix: `${outputPrefixKey}/${spec.label}`,
      playlistKey: `${outputPrefixKey}/${spec.label}/index.m3u8`,
    };
  }

  private async makeThumbnails(
    ffmpeg: string,
    sourceAbs: string,
    thumbPrefixAbs: string,
    thumbPrefixKey: string,
    posterAtSeconds: number,
  ) {
    await fsp.mkdir(thumbPrefixAbs, { recursive: true });
    const posterFile = path.join(thumbPrefixAbs, 'poster.jpg');
    const seek = posterAtSeconds > 0 ? ['-ss', String(posterAtSeconds)] : [];
    await execFileAsync(
      ffmpeg,
      [
        '-y',
        ...seek,
        '-i', sourceAbs,
        '-frames:v', '1',
        '-update', '1',
        '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease',
        '-q:v', '3',
        posterFile,
      ],
      { ...this.execOptions(this.renditionTimeoutMs(0)) },
    );
    return [{ key: `${thumbPrefixKey}/poster.jpg`, kind: 'poster', mimeType: 'image/jpeg' }];
  }

  private async writeMasterPlaylist(
    outputPrefixAbs: string,
    outputPrefixKey: string,
    renditions: TranscodeRenditionResult[],
  ): Promise<string> {
    await fsp.mkdir(outputPrefixAbs, { recursive: true });
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    const variantLines: string[] = [];
    for (const r of renditions.sort((a, b) => a.height - b.height)) {
      variantLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${r.bitrateKbps * 1000},RESOLUTION=${r.width}x${r.height},CODECS="avc1.64001f,mp4a.40.2"`,
        `${r.label}/index.m3u8`,
      );
    }
    const content = lines.concat(variantLines).join('\n') + '\n';
    const masterAbs = path.join(outputPrefixAbs, 'master.m3u8');
    await fsp.writeFile(masterAbs, content, 'utf8');
    return `${outputPrefixKey}/master.m3u8`;
  }
}