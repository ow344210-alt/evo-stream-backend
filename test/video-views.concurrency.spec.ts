import * as crypto from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { VideoViewsService } from '../src/modules/social/video-views.service';
import { VideoPlaybackService } from '../src/modules/video-playback/video-playback.service';

/**
 * Dedicated Real PostgreSQL Concurrency Integration Test
 * 
 * STRICT MULTI-LAYER SAFETY GUARDS:
 * 1. Requires `TEST_DATABASE_URL` to be explicitly defined.
 * 2. Requires `ALLOW_ISOLATED_TEST_DB_RUN=true`.
 * 3. Compares composite destination (hostname, effective port, database path)
 *    to prevent collisions with `DATABASE_URL` or `DIRECT_URL`.
 * 4. Asserts `TEST_DATABASE_URL` does NOT point to remote cloud hosts (e.g. Supabase, Railway).
 * 5. Uses the actual `VideoViewsService` class and exercises real PostgreSQL `pg_advisory_xact_lock`
 *    and rolling 6-hour window queries under 10 concurrent transactions.
 * 6. Explicitly marks test as SKIPPED when prerequisites are absent (no false passes).
 */

function extractDestination(rawUrl: string) {
  const u = new URL(rawUrl);
  const effectivePort = u.port || (u.protocol === 'postgresql:' || u.protocol === 'postgres:' ? '5432' : '');
  return {
    hostname: u.hostname.toLowerCase(),
    port: effectivePort,
    pathname: u.pathname.toLowerCase(),
  };
}

describe('VideoViewsService Real PostgreSQL Concurrency Integration Test', () => {
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const allowRun = process.env.ALLOW_ISOLATED_TEST_DB_RUN === 'true';
  const isConfigured = Boolean(testDbUrl && allowRun);

  let prismaService: PrismaService;
  let videoViewsService: VideoViewsService;
  let playbackServiceMock: VideoPlaybackService;

  const testUserId = crypto.randomUUID();
  const testCreatorProfileId = crypto.randomUUID();
  const testChannelId = crypto.randomUUID();
  const testVideoId = crypto.randomUUID();
  const testUserEmail = `concurrency-test-${Date.now()}@example.internal`;

  beforeAll(async () => {
    if (!isConfigured) {
      console.warn('⚠️  [BLOCKED/SKIPPED] Real PostgreSQL concurrency test is inactive because TEST_DATABASE_URL or ALLOW_ISOLATED_TEST_DB_RUN="true" is missing.');
      return;
    }

    // --- STRICT MULTI-COMPONENT DESTINATION SAFETY CHECKS ---
    const testDest = extractDestination(testDbUrl!);
    const forbiddenHosts = ['supabase.com', 'supabase.co', 'railway.app', 'railway.internal'];
    if (forbiddenHosts.some((h) => testDest.hostname.includes(h))) {
      throw new Error(`[SAFETY BLOCKED] TEST_DATABASE_URL points to a cloud/production host (${testDest.hostname}). Execution refused.`);
    }

    const envDbUrl = process.env.DATABASE_URL;
    if (envDbUrl) {
      try {
        const envDest = extractDestination(envDbUrl);
        if (testDest.hostname === envDest.hostname && testDest.port === envDest.port && testDest.pathname === envDest.pathname) {
          throw new Error('[SAFETY BLOCKED] TEST_DATABASE_URL destination (host, port, and db) matches DATABASE_URL. Execution refused.');
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('[SAFETY BLOCKED]')) throw e;
      }
    }

    const directDbUrl = process.env.DIRECT_URL;
    if (directDbUrl) {
      try {
        const directDest = extractDestination(directDbUrl);
        if (testDest.hostname === directDest.hostname && testDest.port === directDest.port && testDest.pathname === directDest.pathname) {
          throw new Error('[SAFETY BLOCKED] TEST_DATABASE_URL destination (host, port, and db) matches DIRECT_URL. Execution refused.');
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('[SAFETY BLOCKED]')) throw e;
      }
    }

    // Initialize real Prisma client against isolated test DB exclusively
    prismaService = new PrismaService({
      datasources: {
        db: { url: testDbUrl },
      },
    });
    await prismaService.$connect();

    // Mock playback service asserting eligibility for the test video fixture
    playbackServiceMock = {
      assertEligible: jest.fn().mockImplementation(async (videoId: string) => {
        if (videoId === testVideoId) {
          return {
            id: testVideoId,
            title: 'Concurrency Test Video',
            durationSeconds: 60,
            status: 'PUBLISHED',
          };
        }
        throw new Error('Video not found');
      }),
    } as unknown as VideoPlaybackService;

    // Instantiate the actual production VideoViewsService
    videoViewsService = new VideoViewsService(prismaService, playbackServiceMock);

    // Create minimal dedicated test fixtures in isolated database
    await prismaService.user.create({
      data: {
        id: testUserId,
        email: testUserEmail,
        name: 'Concurrency Test User',
        passwordHash: 'test-hash-not-used',
        role: 'USER',
        status: 'ACTIVE',
      },
    });

    await prismaService.creatorProfile.create({
      data: {
        id: testCreatorProfileId,
        userId: testUserId,
      },
    });

    await prismaService.channel.create({
      data: {
        id: testChannelId,
        creatorId: testCreatorProfileId,
        slug: `testchan_${Date.now()}`,
        name: 'Concurrency Test Channel',
      },
    });

    await prismaService.video.create({
      data: {
        id: testVideoId,
        channelId: testChannelId,
        title: 'Concurrency Test Video',
        description: 'Test fixture',
        status: 'PUBLISHED',
        durationSeconds: 60,
      },
    });
  });

  afterAll(async () => {
    if (prismaService) {
      try {
        // Strict isolated cleanup: remove only created test fixtures
        await prismaService.videoView.deleteMany({ where: { videoId: testVideoId } });
        await prismaService.video.deleteMany({ where: { id: testVideoId } });
        await prismaService.channel.deleteMany({ where: { id: testChannelId } });
        await prismaService.creatorProfile.deleteMany({ where: { id: testCreatorProfileId } });
        await prismaService.user.deleteMany({ where: { id: testUserId } });
      } catch (err) {
        console.error('Fixture cleanup error:', err);
      } finally {
        await prismaService.$disconnect();
      }
    }
  });

  const runConcurrencyTest = isConfigured ? it : it.skip;

  runConcurrencyTest('runs the actual VideoViewsService against real PostgreSQL with 10 concurrent requests and records exactly 1 view', async () => {
    const testSessionToken = `anon-device-${crypto.randomUUID()}`;

    // Execute 10 simultaneous calls to the actual VideoViewsService.recordView()
    const concurrentRequests = Array.from({ length: 10 }, (_, i) =>
      videoViewsService.recordView(
        testVideoId,
        undefined, // Anonymous viewer test
        `192.168.10.${i + 1}`, // Different IP simulation
        {
          sessionToken: testSessionToken,
          watchDurationSeconds: 8.5,
        },
      ),
    );

    const results = await Promise.all(concurrentRequests);

    const recorded = results.filter((r) => r.recorded && r.reason === 'NEW_VIEW');
    const duplicates = results.filter((r) => !r.recorded && r.reason === 'DUPLICATE_WINDOW');

    // Exactly 1 request must succeed; exactly 9 must be deduplicated
    expect(recorded).toHaveLength(1);
    expect(duplicates).toHaveLength(9);

    // Verify exactly 1 row in the physical PostgreSQL VideoView table
    const dbCount = await prismaService.videoView.count({
      where: { videoId: testVideoId },
    });
    expect(dbCount).toBe(1);

    // Verify the persisted row
    const savedView = await prismaService.videoView.findFirst({
      where: { videoId: testVideoId },
    });
    expect(savedView).not.toBeNull();
    expect(savedView?.videoId).toBe(testVideoId);
    expect(savedView?.viewerHash).toBeDefined();
  });
});
