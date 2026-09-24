import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessingStatus } from '@prisma/client';
import { VideoProcessingService } from './video-processing.service';
import {
  MAX_CONCURRENT_PROCESSING,
  STALE_PROCESSING_THRESHOLD_MS,
  STARTUP_SWEEP_DELAY_MS,
} from './video-processing.constants';

/**
 * Lightweight in-process processing runner (P2-4) with phase-2 hardening:
 *
 * - `enqueue(videoId)` is non-blocking and schedules the job after the current
 *   request stack clears (`setImmediate`).
 * - Pending jobs run through a FIFO queue bounded by `MAX_CONCURRENT_PROCESSING`
 *   so N uploads cannot launch unlimited FFmpeg work inside the API process.
 * - Video ids are deduplicated (pending + inflight), so the same video can
 *   never be transcribed twice at once.
 * - A startup sweep recovers any video stranded in UPLOADED (normal) and any
 *   PROCESSING row older than `STALE_PROCESSING_THRESHOLD_MS` (crash/hang/DB
 *   flake). Fresh PROCESSING jobs are left running.
 *
 * This is intentionally minimal (no Bull/Redis dependency). A distributed queue
 * can replace this class later without changing the processing service.
 */
@Injectable()
export class VideoProcessingQueue implements OnModuleInit {
  private readonly logger = new Logger(VideoProcessingQueue.name);
  private readonly inflight = new Set<string>();
  private readonly pending: string[] = [];
  private running = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processing: VideoProcessingService,
  ) {}

  onModuleInit(): void {
    // Fire-and-forget: resume videos uploaded but not yet processed, plus any
    // stale PROCESSING rows. Delayed slightly so Prisma can (re-)connect first.
    setTimeout(() => {
      this.sweepUnprocessed().catch((error) => {
        this.logger.error('Startup processing sweep failed', error);
      });
    }, STARTUP_SWEEP_DELAY_MS);
  }

  /**
   * Mark a video for asynchronous processing. Returns immediately; the actual
   * transcode runs after the current tick through the bounded queue.
   */
  enqueue(videoId: string): void {
    // Run after the current request stack clears (DB write is committed).
    setImmediate(() => this.push(videoId));
  }

  private push(videoId: string): void {
    if (this.inflight.has(videoId)) return;
    if (this.pending.includes(videoId)) return;
    this.pending.push(videoId);
    this.drain();
  }

  private drain(): void {
    while (this.running < MAX_CONCURRENT_PROCESSING && this.pending.length > 0) {
      const videoId = this.pending.shift()!;
      if (this.inflight.has(videoId)) continue;
      this.running += 1;
      this.inflight.add(videoId);
      void this.run(videoId).finally(() => {
        this.running -= 1;
        this.inflight.delete(videoId);
        this.drain();
      });
    }
  }

  private async run(videoId: string): Promise<void> {
    try {
      await this.processing.processVideo(videoId);
    } catch (error) {
      this.logger.error(`Processing error for ${videoId}`, error);
    }
  }

  private async sweepUnprocessed(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS);
    const pending = await this.prisma.video.findMany({
      where: {
        OR: [
          { processingStatus: VideoProcessingStatus.UPLOADED },
          {
            processingStatus: VideoProcessingStatus.PROCESSING,
            updatedAt: { lt: staleBefore },
          },
        ],
      },
      select: { id: true },
    });
    for (const item of pending) {
      this.enqueue(item.id);
    }
  }
}