import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessingStatus } from '@prisma/client';
import {
  VIDEO_TRANSCODING_PROVIDER,
  TranscodeResult,
  type VideoTranscodingProvider,
} from './video-transcoding.types';
import { VideoTranscodeConfig } from './video-transcode.config';

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
      return video.processingStatus;
    }

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

      await this.persistResults(videoId, result);

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

      this.logger.log(`Video ${videoId} processed: ${result.renditions.length} renditions, READY`);
      return VideoProcessingStatus.READY;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Video processing failed';
      this.logger.error(`Video processing failed for ${videoId}: ${message}`);
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

  private async persistResults(videoId: string, result: TranscodeResult) {
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
        storageProvider: 'local',
        storageKey: r.playlistKey,
        playlistKey: r.playlistKey,
      })),
    });

    if (result.thumbnails.length > 0) {
      await this.prisma.videoThumbnail.createMany({
        data: result.thumbnails.map((t) => ({
          videoId,
          kind: t.kind,
          storageProvider: 'local',
          storageKey: t.key,
        })),
      });
    }
  }
}