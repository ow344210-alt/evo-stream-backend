import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Safe quality information for a single rendition. */
export interface PlaybackQuality {
  label: string;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
}

/** Complete playback metadata for a ready-to-play video. */
export interface VideoPlaybackMetadata {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  posterUrl: string | null;
  hlsMasterUrl: string | null;
  processingStatus: VideoProcessingStatus | null;
  publicationStatus: VideoStatus;
  publishedAt: string | null;
  availableQualities: PlaybackQuality[];
  channel: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

/**
 * Constructs playback metadata for videos and enforces playback eligibility.
 *
 * Eligibility rules:
 * - processingStatus must be READY
 * - publicationStatus must be PUBLISHED for public playback
 * - HIDDEN/DRAFT videos are not publicly streamable
 * - PROCESSING/FAILED/UPLOADED videos are not playable
 *
 * All URLs returned are API-relative (e.g. /api/media/...) so the frontend
 * constructs absolute URLs using its configured API base. No filesystem
 * paths are ever exposed.
 */
@Injectable()
export class VideoPlaybackService {
  private readonly logger = new Logger(VideoPlaybackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get playback metadata for a video by ID. Only returns data for videos
   * that are eligible for playback (READY + PUBLISHED for public access).
   */
  async getPlaybackMetadata(videoId: string): Promise<VideoPlaybackMetadata> {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: {
        channel: { select: { id: true, name: true, slug: true } },
        renditions: {
          orderBy: { height: 'asc' },
          select: {
            label: true,
            width: true,
            height: true,
            bitrateKbps: true,
          },
        },
      },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    return this.buildPlaybackMetadata(video);
  }

  /**
   * Get playback metadata for a video by channel slug + video slug/id.
   * Used for public viewer access.
   */
  async getPublicPlaybackMetadata(videoId: string): Promise<VideoPlaybackMetadata> {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: {
        channel: { select: { id: true, name: true, slug: true } },
        renditions: {
          orderBy: { height: 'asc' },
          select: {
            label: true,
            width: true,
            height: true,
            bitrateKbps: true,
          },
        },
      },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }

    if (video.processingStatus !== VideoProcessingStatus.READY) {
      throw new NotFoundException('Video is not available for playback');
    }

    if (video.status !== VideoStatus.PUBLISHED) {
      throw new NotFoundException('Video is not available for playback');
    }

    return this.buildPlaybackMetadata(video);
  }

  /**
   * Assert that a video is publicly eligible for social interaction.
   *
   * Reuses the same eligibility rules as playback: the video must exist,
   * be READY (fully processed), and PUBLISHED. This is the single source of
   * truth for "can a viewer like/comment/save/share this video", so social
   * reads and mutations never duplicate or diverge from the playback rule.
   *
   * Returns the eligible video row (with channel) so callers can inspect it,
   * or throws NotFoundException when the video is missing or not eligible.
   */
  async assertEligible(videoId: string) {
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { channel: { select: { id: true, name: true, slug: true } } },
    });

    if (!video) {
      throw new NotFoundException('Video not found');
    }
    if (video.processingStatus !== VideoProcessingStatus.READY) {
      throw new NotFoundException('Video is not available');
    }
    if (video.status !== VideoStatus.PUBLISHED) {
      throw new NotFoundException('Video is not available');
    }
    return video;
  }

  private buildPlaybackMetadata(video: {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number | null;
    posterThumbnailKey: string | null;
    hlsMasterKey: string | null;
    processingStatus: VideoProcessingStatus | null;
    status: VideoStatus;
    publishedAt: Date | null;
    channel: { id: string; name: string; slug: string } | null;
    renditions: Array<{
      label: string;
      width: number | null;
      height: number | null;
      bitrateKbps: number | null;
    }>;
  }): VideoPlaybackMetadata {
    const posterUrl = video.posterThumbnailKey
      ? `/api/media/${video.id}/${this.stripVideoPrefix(video.posterThumbnailKey)}`
      : null;

    const hlsMasterUrl = video.hlsMasterKey
      ? `/api/media/${video.id}/${this.stripVideoPrefix(video.hlsMasterKey)}`
      : null;

    return {
      id: video.id,
      title: video.title,
      description: video.description,
      durationSeconds: video.durationSeconds,
      posterUrl,
      hlsMasterUrl,
      processingStatus: video.processingStatus,
      publicationStatus: video.status,
      publishedAt: video.publishedAt?.toISOString() ?? null,
      availableQualities: video.renditions.map((r) => ({
        label: r.label,
        width: r.width,
        height: r.height,
        bitrateKbps: r.bitrateKbps,
      })),
      channel: video.channel,
    };
  }

  /**
   * Strip the `videos/{videoId}/` prefix from a storage key to produce
   * the relative path expected by the media endpoint.
   *
   * E.g. `videos/abc-123/hls/master.m3u8` -> `hls/master.m3u8`
   * E.g. `videos/abc-123/thumbnails/poster.jpg` -> `thumbnails/poster.jpg`
   */
  private stripVideoPrefix(storageKey: string): string {
    const parts = storageKey.split('/');
    // Expected format: videos/{videoId}/rest/of/path
    if (parts.length >= 3 && parts[0] === 'videos') {
      return parts.slice(2).join('/');
    }
    return storageKey;
  }
}
