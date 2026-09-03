import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessingStatus } from '@prisma/client';
import { VideoProcessingService } from './video-processing.service';

/**
 * Lightweight in-process processing runner (P2-4).
 *
 * - Enqueues a video id for asynchronous processing.
 * - Runs a startup sweep for any video left in UPLOADED so an interrupted
 *   process resumes work.
 * - Maintains a single-flight in-memory set so the same video can't be
 *   processed concurrently.
 *
 * This is intentionally minimal (no Bull/Redis dependency). A distributed queue
 * can replace this class later without changing the processing service.
 */
@Injectable()
export class VideoProcessingQueue implements OnModuleInit {
  private readonly logger = new Logger(VideoProcessingQueue.name);
  private readonly inflight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly processing: VideoProcessingService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Fire-and-forget: resume any videos uploaded but not yet processed.
    this.sweepUnprocessed().catch((error) => {
      this.logger.error('Startup processing sweep failed', error);
    });
  }

  /**
   * Mark a video for asynchronous processing. Returns immediately; the actual
   * transcode runs after the current tick.
   */
  enqueue(videoId: string): void {
    // Run after the current request stack clears (DB write is committed).
    setImmediate(() => {
      void this.run(videoId);
    });
  }

  private async run(videoId: string): Promise<void> {
    if (this.inflight.has(videoId)) return;
    this.inflight.add(videoId);
    try {
      await this.processing.processVideo(videoId);
    } catch (error) {
      this.logger.error(`Processing error for ${videoId}`, error);
    } finally {
      this.inflight.delete(videoId);
    }
  }

  private async sweepUnprocessed(): Promise<void> {
    const pending = await this.prisma.video.findMany({
      where: { processingStatus: VideoProcessingStatus.UPLOADED },
      select: { id: true },
    });
    for (const item of pending) {
      this.run(item.id);
    }
  }
}