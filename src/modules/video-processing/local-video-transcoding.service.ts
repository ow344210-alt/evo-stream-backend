import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
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
import { resolveWithin } from '../video-storage/storage-path.util';

const execFileAsync = promisify(execFile);

/**
 * FFmpeg-backed transcoder for local storage. Produces an adaptive HLS ladder
 * plus a poster thumbnail, written directly under the local storage root so the
 * catalogued provider-relative keys remain stable and storage-consistent.
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
  ) {}

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

    if (!this.storageConfig.localStoragePath) {
      throw new Error('Local transcoding requires the local storage provider (VIDEO_STORAGE_PROVIDER=local).');
    }

    const root = path.resolve(this.storageConfig.localStoragePath);
    const sourceAbs = resolveWithin(root, options.sourceKey);
    if (!fs.existsSync(sourceAbs)) {
      throw new Error(`Source object not found at ${options.sourceKey}`);
    }

    const outputPrefixAbs = resolveWithin(root, options.outputPrefix);
    const thumbPrefixAbs = resolveWithin(root, options.thumbnailPrefix);

    const duration = await this.probeDuration(ffprobe, sourceAbs);

    const renditions: TranscodeRenditionResult[] = [];
    for (const spec of options.renditions) {
      renditions.push(
        await this.makeRendition(ffmpeg, sourceAbs, outputPrefixAbs, options.outputPrefix, spec),
      );
    }

    const posterAt = options.posterAtSeconds ?? 0;
    const thumbKeys = await this.makeThumbnails(
      ffmpeg,
      sourceAbs,
      thumbPrefixAbs,
      options.thumbnailPrefix,
      posterAt,
    );

    const masterKey = await this.writeMasterPlaylist(
      outputPrefixAbs,
      options.outputPrefix,
      renditions,
    );

    return {
      renditions,
      thumbnails: thumbKeys,
      masterPlaylistKey: masterKey,
      durationSeconds: duration,
    };
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
      { windowsHide: true },
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

    await execFileAsync(ffmpeg, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
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
        '-vf', 'scale=w=1280:h=720:force_original_aspect_ratio=decrease',
        '-q:v', '3',
        posterFile,
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
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