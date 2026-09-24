import { VideoViewsService } from './video-views.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoPlaybackService } from '../video-playback/video-playback.service';

describe('VideoViewsService', () => {
  let service: VideoViewsService;
  let prisma: any;
  let playback: any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb) => {
        const tx = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          videoView: {
            findFirst: jest.fn(),
            create: jest.fn().mockResolvedValue({ id: 'view-1' }),
          },
        };
        return cb(tx);
      }),
    };

    playback = {
      assertEligible: jest.fn().mockResolvedValue({
        id: 'vid-1',
        title: 'Test Video',
        durationSeconds: 60,
        status: 'PUBLISHED',
      }),
    };

    service = new VideoViewsService(prisma as PrismaService, playback as VideoPlaybackService);
  });

  describe('computeViewerHash', () => {
    it('generates a stable deterministic hash for authenticated users', () => {
      const hash1 = service.computeViewerHash('user-123');
      const hash2 = service.computeViewerHash('user-123');
      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('u:')).toBe(true);
    });

    it('generates a stable anonymous hash from sessionToken independent of IP', () => {
      const hash1 = service.computeViewerHash(undefined, 'session-abc-123');
      const hash2 = service.computeViewerHash(undefined, 'session-abc-123');
      expect(hash1).toBe(hash2);
      expect(hash1.startsWith('a:')).toBe(true);
    });

    it('generates different hashes for different anonymous session tokens', () => {
      const hashA = service.computeViewerHash(undefined, 'session-device-A');
      const hashB = service.computeViewerHash(undefined, 'session-device-B');
      expect(hashA).not.toBe(hashB);
    });
  });

  describe('recordView qualification and rolling deduplication', () => {
    it('records a new qualified view when no view exists in the 6-hour window and persists watchDurationSeconds', async () => {
      let createdPayload: any = null;
      prisma.$transaction = jest.fn(async (cb) => {
        const tx = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          videoView: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async ({ data }) => {
              createdPayload = data;
              return { id: 'view-1', ...data };
            }),
          },
        };
        return cb(tx);
      });

      const result = await service.recordView('vid-1', 'user-1', '127.0.0.1', {
        watchDurationSeconds: 8.75,
      });

      expect(result.recorded).toBe(true);
      expect(result.reason).toBe('NEW_VIEW');
      expect(playback.assertEligible).toHaveBeenCalledWith('vid-1');
      expect(createdPayload).toEqual(
        expect.objectContaining({
          videoId: 'vid-1',
          userId: 'user-1',
          watchDurationSeconds: 8.75,
        }),
      );
    });

    it('deduplicates views within the rolling 6-hour window', async () => {
      prisma.$transaction = jest.fn(async (cb) => {
        const tx = {
          $executeRaw: jest.fn().mockResolvedValue(1),
          videoView: {
            findFirst: jest.fn().mockResolvedValue({ id: 'existing-view-id' }),
            create: jest.fn(),
          },
        };
        return cb(tx);
      });

      const result = await service.recordView('vid-1', 'user-1', '127.0.0.1', {
        watchDurationSeconds: 10,
      });

      expect(result.recorded).toBe(false);
      expect(result.reason).toBe('DUPLICATE_WINDOW');
    });

    it('rejects views with insufficient watch duration for standard videos', async () => {
      const result = await service.recordView('vid-1', 'user-1', '127.0.0.1', {
        watchDurationSeconds: 2, // Less than 4.5s for 60s video
      });

      expect(result.recorded).toBe(false);
      expect(result.reason).toBe('INSUFFICIENT_DURATION');
    });

    it('accepts short clips with watch duration >= 50% of clip length', async () => {
      playback.assertEligible.mockResolvedValueOnce({
        id: 'short-vid-1',
        title: 'Short Clip',
        durationSeconds: 6, // 6s clip -> threshold is 3s
        status: 'PUBLISHED',
      });

      const result = await service.recordView('short-vid-1', 'user-1', '127.0.0.1', {
        watchDurationSeconds: 3.5,
      });

      expect(result.recorded).toBe(true);
      expect(result.reason).toBe('NEW_VIEW');
    });

    it('rejects views claiming duration exceeding video duration + tolerance', async () => {
      const result = await service.recordView('vid-1', 'user-1', '127.0.0.1', {
        watchDurationSeconds: 100, // Video is 60s -> max allowed is 65s
      });

      expect(result.recorded).toBe(false);
      expect(result.reason).toBe('EXCEEDS_DURATION');
    });

    it('rate limits excessive view submissions from a single IP', async () => {
      // Simulate 31 rapid requests from the same IP
      for (let i = 0; i < 30; i++) {
        await service.recordView('vid-1', 'user-1', '10.0.0.99', { watchDurationSeconds: 5 });
      }

      const throttledResult = await service.recordView('vid-1', 'user-1', '10.0.0.99', {
        watchDurationSeconds: 5,
      });

      expect(throttledResult.recorded).toBe(false);
      expect(throttledResult.reason).toBe('RATE_LIMITED');
    });
  });

  describe('PostgreSQL Concurrency Simulation (10 Simultaneous Submissions)', () => {
    it('serializes concurrent requests via advisory lock and inserts exactly 1 view', async () => {
      // State machine simulating atomic PostgreSQL transaction execution under advisory lock
      const dbViews: any[] = [];
      let lockAcquired = false;

      prisma.$transaction = jest.fn(async (cb) => {
        // Wait if another transaction is executing under the advisory lock
        while (lockAcquired) {
          await new Promise((r) => setTimeout(r, 5));
        }
        lockAcquired = true;

        try {
          const tx = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            videoView: {
              findFirst: jest.fn().mockImplementation(async ({ where }) => {
                const sixHoursAgo = where.viewedAt.gte;
                return (
                  dbViews.find(
                    (v) =>
                      v.videoId === where.videoId &&
                      v.viewerHash === where.viewerHash &&
                      v.viewedAt >= sixHoursAgo,
                  ) || null
                );
              }),
              create: jest.fn().mockImplementation(async ({ data }) => {
                const newView = { id: `view-${dbViews.length + 1}`, ...data, viewedAt: new Date() };
                dbViews.push(newView);
                return newView;
              }),
            },
          };
          return await cb(tx);
        } finally {
          lockAcquired = false;
        }
      });

      // Launch 10 simultaneous requests in parallel
      const requests = Array.from({ length: 10 }).map((_, i) =>
        service.recordView('vid-concurrency', 'user-concurrent-1', `192.168.1.${i + 1}`, {
          watchDurationSeconds: 5,
        }),
      );

      const results = await Promise.all(requests);

      const recordedCount = results.filter((r) => r.recorded).length;
      const rejectedCount = results.filter((r) => !r.recorded && r.reason === 'DUPLICATE_WINDOW').length;

      expect(recordedCount).toBe(1);
      expect(rejectedCount).toBe(9);
      expect(dbViews.length).toBe(1);
    });
  });
});
