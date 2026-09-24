import { VideoProcessingStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoProcessingService } from './video-processing.service';
import {
  MAX_CONCURRENT_PROCESSING,
  STALE_PROCESSING_THRESHOLD_MS,
} from './video-processing.constants';
import { VideoProcessingQueue } from './video-processing.queue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('VideoProcessingQueue', () => {
  let prisma: { video: { findMany: jest.Mock } };
  let processing: { processVideo: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { video: { findMany: jest.fn().mockResolvedValue([]) } };
    processing = { processVideo: jest.fn().mockResolvedValue(VideoProcessingStatus.READY) };
  });

  it('is non-blocking: enqueue returns immediately and defers work past the current tick', () => {
    const queue = new VideoProcessingQueue(
      prisma as unknown as PrismaService,
      processing as unknown as VideoProcessingService,
    );

    queue.enqueue('v1');
    queue.enqueue('v2');

    expect(processing.processVideo).not.toHaveBeenCalled();
  });

  it('processes enqueued videos in FIFO order', async () => {
    const queue = new VideoProcessingQueue(
      prisma as unknown as PrismaService,
      processing as unknown as VideoProcessingService,
    );

    ['v1', 'v2', 'v3'].forEach((id) => queue.enqueue(id));
    await flush();

    expect(processing.processVideo.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2', 'v3']);
  });

  it('deduplicates a video that is already pending or inflight', async () => {
    const gates: Array<() => void> = [];
    processing.processVideo.mockImplementation(() => {
      const gate = deferred<void>();
      gates.push(() => gate.resolve());
      return gate.promise;
    });
    const queue = new VideoProcessingQueue(
      prisma as unknown as PrismaService,
      processing as unknown as VideoProcessingService,
    );

    queue.enqueue('v1');
    queue.enqueue('v1');
    queue.enqueue('v2');
    queue.enqueue('v2');
    await flush();

    // Duplicate enqueues must not start a second job while the first is inflight.
    expect(processing.processVideo).toHaveBeenCalledTimes(2);
    expect(processing.processVideo.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2']);

    gates.forEach((g) => g());
    await flush();
  });

  it('never exceeds the global concurrency cap and starts queued jobs as slots free up', async () => {
    const gates: Array<() => void> = [];
    const active = { current: 0, max: 0 };
    processing.processVideo.mockImplementation(() => {
      active.current += 1;
      active.max = Math.max(active.max, active.current);
      const gate = deferred<void>();
      gates.push(() => {
        active.current -= 1;
        gate.resolve();
      });
      return gate.promise;
    });
    const queue = new VideoProcessingQueue(
      prisma as unknown as PrismaService,
      processing as unknown as VideoProcessingService,
    );

    ['v1', 'v2', 'v3', 'v4', 'v5'].forEach((id) => queue.enqueue(id));
    await flush();

    expect(processing.processVideo).toHaveBeenCalledTimes(MAX_CONCURRENT_PROCESSING);
    expect(active.current).toBe(MAX_CONCURRENT_PROCESSING);
    expect(active.max).toBe(MAX_CONCURRENT_PROCESSING);

    // Free one slot at a time; the next queued job must start, never exceeding the cap.
    for (let i = 0; i < 5; i++) {
      gates.shift()?.();
      await flush();
    }

    expect(processing.processVideo).toHaveBeenCalledTimes(5);
    expect(active.current).toBe(0);
    expect(active.max).toBe(MAX_CONCURRENT_PROCESSING);
  });

  it('starts the next queued job when an active job fails', async () => {
    processing.processVideo
      .mockRejectedValueOnce(new Error('transcode exploded'))
      .mockRejectedValueOnce(new Error('transcode exploded'))
      .mockResolvedValueOnce(VideoProcessingStatus.READY);
    const queue = new VideoProcessingQueue(
      prisma as unknown as PrismaService,
      processing as unknown as VideoProcessingService,
    );

    ['v1', 'v2', 'v3'].forEach((id) => queue.enqueue(id));
    await flush();
    await flush();
    await flush();

    expect(processing.processVideo).toHaveBeenCalledTimes(3);
  });

  it('boot sweep enqueues UPLOADED and stale PROCESSING rows but never fresh/inert rows', async () => {
    prisma.video.findMany.mockResolvedValue([
      { id: 'uploaded-1' },
      { id: 'stale-1' },
    ]);
    const queue = new VideoProcessingQueue(
      prisma as unknown as PrismaService,
      processing as unknown as VideoProcessingService,
    );

    await (queue as unknown as { sweepUnprocessed(): Promise<void> }).sweepUnprocessed();
    await flush();

    const where = prisma.video.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { processingStatus: VideoProcessingStatus.UPLOADED },
      {
        processingStatus: VideoProcessingStatus.PROCESSING,
        updatedAt: { lt: expect.any(Date) },
      },
    ]);
    expect(processing.processVideo.mock.calls.map((c) => c[0])).toEqual([
      'uploaded-1',
      'stale-1',
    ]);
    expect(STALE_PROCESSING_THRESHOLD_MS).toBe(10 * 60 * 1000);
  });

  it('boot-recovered jobs respect the same global concurrency limit', async () => {
    prisma.video.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
    ]);
    const gates: Array<() => void> = [];
    const active = { current: 0, max: 0 };
    processing.processVideo.mockImplementation(() => {
      active.current += 1;
      active.max = Math.max(active.max, active.current);
      const gate = deferred<void>();
      gates.push(() => {
        active.current -= 1;
        gate.resolve();
      });
      return gate.promise;
    });
    const queue = new VideoProcessingQueue(
      prisma as unknown as PrismaService,
      processing as unknown as VideoProcessingService,
    );

    await (queue as unknown as { sweepUnprocessed(): Promise<void> }).sweepUnprocessed();
    await flush();

    expect(active.current).toBe(MAX_CONCURRENT_PROCESSING);
    expect(active.max).toBe(MAX_CONCURRENT_PROCESSING);

    for (let i = 0; i < 4; i++) {
      gates.shift()?.();
      await flush();
    }

    expect(active.current).toBe(0);
    expect(processing.processVideo).toHaveBeenCalledTimes(4);
    expect(active.max).toBe(MAX_CONCURRENT_PROCESSING);
  });
});