import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessingStatus } from '@prisma/client';
import {
  VIDEO_TRANSCODING_PROVIDER,
  TranscodeResult,
  type VideoTranscodingProvider,
} from './video-transcoding.types';
import { VideoTranscodeConfig } from './video-transcode.config';
import {
  VIDEO_STORAGE_PROVIDER,
  type VideoStorageProvider,
} from '../video-storage/video-storage.types';
import { normaliseKeySeparators } from '../video-storage/storage-path.util';
import { STALE_PROCESSING_THRESHOLD_MS } from './video-processing.constants';

/**
 * Orchestrates the end-to-end processing of a stored source video:
 *
 *   UPLOADED -> PROCESSING -> READY | FAILED
 *
 * Responsibilities:
 * - Loads the stored source object's identity from the Video row.
 * - Transcodes it into the adaptive HLS ladder + poster via the transcoding
 *   provider.
 * - Persists one `VideoRendition` per tier and one `VideoThumbnail` per derived
 *   frame, using the provider-stable keys.
 * - Sets the master HLS playlist + poster keys on the Video and marks it READY.
 * - On any failure marks the Video FAILED and records a short `processError`
 *   (never an absolute path or secret).
 *
 * Idempotency: any pre-existing renditions/thumbnails for the video are cleared
 * before persisting new results, so a retry converges instead of duplicating.
 */
@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(VIDEO_TRANSCODING_PROVIDER) private readonly transcoder: VideoTranscodingProvider,
    private readonly transcodeConfig: VideoTranscodeConfig,
    @Inject(VIDEO_STORAGE_PROVIDER) private readonly storage: VideoStorageProvider,
  ) {}

  /**
   * Process a single video by id. Only videos that have a stored source and are
   * still unprocessed-or-failed are handled. Returns the final processing status.
   */
  async processVideo(videoId: string): Promise<VideoProcessingStatus> {
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new Error(`Video ${videoId} not found`);
    if (!video.sourceStorageKey) {
      return video.processingStatus ?? VideoProcessingStatus.UPLOADED;
    }
    if (video.processingStatus === VideoProcessingStatus.PROCESSING) {
      const ageMs = video.updatedAt
        ? Date.now() - video.updatedAt.getTime()
        : 0;
      if (ageMs < STALE_PROCESSING_THRESHOLD_MS) {
        // Fresh run: another process (or an in-flight job) owns this video.
        return video.processingStatus;
      }
      this.logger.warn(
        `Video ${videoId} was left PROCESSING for ${Math.round(ageMs / 1000)}s; recovering it`,
      );
    }

    this.logger.log(`Processing started for video ${videoId}`);
    const startedAt = Date.now();

    try {
      await this.prisma.video.update({
        where: { id: videoId },
        data: {
          processingStatus: VideoProcessingStatus.PROCESSING,
          processError: null,
        },
      });

      const result = await this.transcoder.transcode({
        sourceKey: video.sourceStorageKey,
        outputPrefix: `videos/${videoId}/hls`,
        thumbnailPrefix: `videos/${videoId}/thumbnails`,
        renditions: [...this.transcodeConfig.renditions],
        posterAtSeconds: this.transcodeConfig.posterAtSeconds,
      });
      this.logger.log(
        `Transcode completed for video ${videoId}: ${result.renditions.length} renditions, duration=${result.durationSeconds}s`,
      );

      // For remote providers, upload the complete HLS tree (master + variant
      // playlists + TS segments + poster) so the relative references inside the
      // playlists resolve over the CDN, then hand the real provider name to the
      // persistence step (never the hardcoded "local").
      await this.publishToActiveProvider(videoId, result);

      await this.persistResults(videoId, result, this.storage.name);
      this.logger.log(`DB persistence completed for video ${videoId}`);

      await this.prisma.video.update({
        where: { id: videoId },
        data: {
          processingStatus: VideoProcessingStatus.READY,
          hlsMasterKey: result.masterPlaylistKey,
          posterThumbnailKey: result.thumbnails.find((t) => t.kind === 'poster')?.key ?? null,
          processError: null,
          durationSeconds: result.durationSeconds,
        },
      });

      this.logger.log(
        `Video ${videoId} processed: ${result.renditions.length} renditions, READY (${this.elapsedSeconds(startedAt)})`,
      );
      return VideoProcessingStatus.READY;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Video processing failed';
      this.logger.error(
        `Video processing failed for ${videoId}: ${message} (${this.elapsedSeconds(startedAt)})`,
      );
      await this.prisma.video
        .update({
          where: { id: videoId },
          data: {
            processingStatus: VideoProcessingStatus.FAILED,
            processError: message.slice(0, 500),
          },
        })
        .catch((markError) => {
          this.logger.error(`Could not mark video ${videoId} FAILED`, markError);
        });
      return VideoProcessingStatus.FAILED;
    }
  }

  private elapsedSeconds(startedAt: number): string {
    return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  }

  private async persistResults(videoId: string, result: TranscodeResult, providerName: string) {
    await this.prisma.videoRendition.deleteMany({ where: { videoId } });
    await this.prisma.videoThumbnail.deleteMany({ where: { videoId } });

    await this.prisma.videoRendition.createMany({
      data: result.renditions.map((r) => ({
        videoId,
        label: r.label,
        height: r.height,
        width: r.width,
        bitrateKbps: r.bitrateKbps,
        codec: r.codec,
        storageProvider: providerName,
        storageKey: r.playlistKey,
        playlistKey: r.playlistKey,
      })),
    });

    if (result.thumbnails.length > 0) {
      await this.prisma.videoThumbnail.createMany({
        data: result.thumbnails.map((t) => ({
          videoId,
          kind: t.kind,
          storageProvider: providerName,
          storageKey: t.key,
        })),
      });
    }
  }

  /**
   * Publish the transcoded artifact tree to the active storage provider.
   *
   * - `local` provider: the transcoder already wrote the tree directly into the
   *   storage root; nothing to do.
   * - Remote providers: every file produced by the transcoder is uploaded from
   *   `result.outputRoot` preserving the relative layout. If the upload fails,
   *   the partial cloud objects for this video's hls/thumbnail prefixes are
   *   best-effort removed before re-throwing, and the local workspace is always
   *   cleaned up.
   */
  private async publishToActiveProvider(videoId: string, result: TranscodeResult): Promise<void> {
    const outputRoot = result.outputRoot;
    if (!outputRoot) return;

    try {
      const files = await this.listFilesRecursively(outputRoot);
      this.logger.log(
        `Publishing HLS tree to ${this.storage.name} for video ${videoId}: ${files.length} artifacts`,
      );
      for (const file of files) {
        const relative = path.relative(outputRoot, file);
        const key = normaliseKeySeparators(relative);
        if (!key) continue;
        const buffer = await fsp.readFile(file);
        await this.storage.store({ buffer, objectPath: key });
      }

      // Verify the durable anchor objects are actually stored before claiming
      // READY; a missing tree must fail processing, not report success.
      const master = await this.storage.getObject(result.masterPlaylistKey);
      const poster =
        result.thumbnails.find((t) => t.kind === 'poster')?.key ?? null;
      const posterObject = poster ? await this.storage.getObject(poster) : null;
      if (!master || (poster && !posterObject)) {
        throw new Error(`Durable HLS tree was not fully stored for video ${videoId}`);
      }
      if (files.length > 0) {
        this.logger.log(`HLS tree published to ${this.storage.name} for video ${videoId}`);
      }
    } catch (error) {
      this.logger.error(`Publishing HLS tree to ${this.storage.name} failed for ${videoId}`, error);
      const prefixes = [`videos/${videoId}/hls`, `videos/${videoId}/thumbnails`];
      for (const prefix of prefixes) {
        await this.storage.deletePrefix(prefix).catch(() => undefined);
      }
      throw error;
    } finally {
      await fsp.rm(outputRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async listFilesRecursively(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.listFilesRecursively(absolute)));
      } else if (entry.isFile()) {
        results.push(absolute);
      }
    }
    return results;
  }
}