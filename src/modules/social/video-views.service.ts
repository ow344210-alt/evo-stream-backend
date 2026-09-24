import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';
import { RecordViewDto } from './dto/record-view.dto';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RecordViewResult {
  recorded: boolean;
  reason: 'NEW_VIEW' | 'DUPLICATE_WINDOW' | 'INSUFFICIENT_DURATION' | 'EXCEEDS_DURATION' | 'RATE_LIMITED';
}

/**
 * Service for recording qualified, abuse-resistant video view events.
 * Enforces transaction-scoped PostgreSQL advisory locks to guarantee
 * rolling 6-hour deduplication even under concurrent race conditions.
 */
@Injectable()
export class VideoViewsService {
  private readonly logger = new Logger(VideoViewsService.name);
  private readonly pepper: string;
  private readonly rateLimits = new Map<string, RateLimitEntry>();
  private readonly rateLimitMax = 30; // Max 30 view submissions per minute per IP
  private readonly rateLimitWindowMs = 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly playback: VideoPlaybackService,
  ) {
    this.pepper =
      process.env.VIEW_TRACKING_PEPPER ||
      process.env.JWT_SECRET ||
      'evo_default_telemetry_view_pepper';

    // Periodically clean up expired rate-limit buckets every 5 minutes
    setInterval(() => this.cleanupRateLimits(), 5 * 60 * 1000).unref?.();
  }

  /**
   * Derive a stable pseudonymous viewer hash.
   * - Authenticated: hashed from userId.
   * - Anonymous: HMAC-SHA256 of the persistent device ID and server secret pepper.
   * Note: Client IP is excluded from the hash to preserve stability across cellular/WiFi handoffs.
   */
  computeViewerHash(userId?: string, sessionToken?: string): string {
    if (userId) {
      return (
        'u:' +
        crypto.createHash('sha256').update(userId.trim()).digest('hex').slice(0, 32)
      );
    }
    const token = (sessionToken || 'anon_anonymous_client').trim();
    return (
      'a:' +
      crypto
        .createHmac('sha256', this.pepper)
        .update(token)
        .digest('hex')
        .slice(0, 32)
    );
  }

  /**
   * Check in-memory IP rate limiter to mitigate denial-of-service or bot flooding.
   * Note: This is an in-memory process limiter intended for single-instance or edge protection.
   */
  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(ip);
    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(ip, { count: 1, resetAt: now + this.rateLimitWindowMs });
      return true;
    }
    if (entry.count >= this.rateLimitMax) {
      return false;
    }
    entry.count++;
    return true;
  }

  private cleanupRateLimits(): void {
    const now = Date.now();
    for (const [ip, entry] of this.rateLimits.entries()) {
      if (now > entry.resetAt) {
        this.rateLimits.delete(ip);
      }
    }
  }

  /**
   * Record a qualified playback view event.
   * Uses a PostgreSQL transaction-scoped advisory lock for concurrency safety.
   */
  async recordView(
    videoId: string,
    userId: string | undefined,
    clientIp: string,
    dto: RecordViewDto = {},
  ): Promise<RecordViewResult> {
    // 1. IP rate limiting
    if (clientIp && !this.checkRateLimit(clientIp)) {
      return { recorded: false, reason: 'RATE_LIMITED' };
    }

    // 2. Video eligibility check (must be READY and PUBLISHED)
    const video = await this.playback.assertEligible(videoId);

    // 3. Consumed media duration validation
    const duration = video.durationSeconds ?? 0;
    const watched = dto.watchDurationSeconds ?? 5; // Defaults to 5s if omitted by basic beacon

    if (duration > 0) {
      const minRequired = duration >= 10 ? 4.5 : Math.min(4.5, duration * 0.5);
      if (watched < minRequired) {
        return { recorded: false, reason: 'INSUFFICIENT_DURATION' };
      }
      // Tolerance of +5s for clock drift
      if (watched > duration + 5.0) {
        return { recorded: false, reason: 'EXCEEDS_DURATION' };
      }
    }

    // 4. Compute viewer hash
    const viewerHash = this.computeViewerHash(userId, dto.sessionToken);

    // 5. Concurrency-safe atomic rolling 6-hour insertion inside a single interactive transaction
    return await this.prisma.$transaction(
      async (tx) => {
        // Acquire 64-bit advisory lock derived from (videoId, viewerHash)
        // Automatically released when the transaction finishes (commit or rollback)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('video_view:' || ${videoId} || ':' || ${viewerHash}))`;

        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        const existing = await tx.videoView.findFirst({
          where: {
            videoId,
            viewerHash,
            viewedAt: { gte: sixHoursAgo },
          },
          select: { id: true },
        });

        if (existing) {
          return { recorded: false, reason: 'DUPLICATE_WINDOW' };
        }

        await tx.videoView.create({
          data: {
            videoId,
            userId: userId || null,
            viewerHash,
            watchDurationSeconds: watched,
          },
        });

        return { recorded: true, reason: 'NEW_VIEW' };
      },
      { timeout: 10000 },
    );
  }
}
