import { VideoProcessingStatus } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VideoProcessingService } from './video-processing.service';
import {
  TranscodeResult,
  VideoTranscodingProvider,
} from './video-transcoding.types';
import { PrismaService } from '../../prisma/prisma.service';

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;
  let prisma: {
    video: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    videoRendition: { deleteMany: jest.Mock; createMany: jest.Mock };
    videoThumbnail: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let transcoder: VideoTranscodingProvider;
  let transcodeConfig: { renditions: unknown[]; posterAtSeconds: number };
  let storage: {
    name: string;
    store: jest.Mock;
    getObject: jest.Mock;
    deletePrefix: jest.Mock;
    read: jest.Mock;
    delete: jest.Mock;
  };

  const readyResult: TranscodeResult = {
    renditions: [
      { label: '360p', height: 360, width: 640, bitrateKbps: 450, codec: 'h264', segmentPrefix: 'videos/v1/hls/360p', playlistKey: 'videos/v1/hls/360p/index.m3u8' },
      { label: '720p', height: 720, width: 1280, bitrateKbps: 1500, codec: 'h264', segmentPrefix: 'videos/v1/hls/720p', playlistKey: 'videos/v1/hls/720p/index.m3u8' },
    ],
    thumbnails: [{ key: 'videos/v1/thumbnails/poster.jpg', kind: 'poster', mimeType: 'image/jpeg' }],
    masterPlaylistKey: 'videos/v1/hls/master.m3u8',
    durationSeconds: 12,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    transcodeConfig = { renditions: [{ label: '720p' }], posterAtSeconds: 5 };
    transcoder = { name: 'fake', transcode: jest.fn().mockResolvedValue(readyResult) };

    prisma = {
      video: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      videoRendition: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      videoThumbnail: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    storage = {
      name: 'local',
      store: jest.fn(),
      getObject: jest.fn(),
      deletePrefix: jest.fn(),
      read: jest.fn(),
      delete: jest.fn(),
    };

    service = new VideoProcessingService(
      prisma as unknown as PrismaService,
      transcoder,
      transcodeConfig as never,
      storage as never,
    );
  });

  it('transcodes, persists renditions + poster, and marks the video READY', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: 'videos/v1/source/clip.mp4',
      processingStatus: VideoProcessingStatus.UPLOADED,
    });
    prisma.video.update = jest.fn().mockResolvedValue({ id: 'v1' });

    const status = await service.processVideo('v1');
    expect(status).toBe(VideoProcessingStatus.READY);

    expect(transcoder.transcode).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: 'videos/v1/source/clip.mp4',
        outputPrefix: 'videos/v1/hls',
        renditions: [{ label: '720p' }],
        posterAtSeconds: 5,
      }),
    );
    expect(prisma.videoRendition.deleteMany).toHaveBeenCalled();
    expect(prisma.videoRendition.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ videoId: 'v1', label: '360p', playlistKey: 'videos/v1/hls/360p/index.m3u8' }),
        ]),
      }),
    );
    expect(prisma.videoThumbnail.createMany).toHaveBeenCalled();

    // First update sets PROCESSING, last update marks READY with keys.
    const updates = prisma.video.update.mock.calls.map((c) => c[0].data.processingStatus);
    expect(updates).toContain(VideoProcessingStatus.PROCESSING);
    expect(updates).toContain(VideoProcessingStatus.READY);

    // Verify durationSeconds is persisted.
    const readyUpdate = prisma.video.update.mock.calls
      .map((c) => c[0].data)
      .find((d) => d.processingStatus === VideoProcessingStatus.READY);
    expect(readyUpdate).toBeDefined();
    expect(readyUpdate.durationSeconds).toBe(12);
  });

  it('marks a video FAILED and records a process error when transcoding rejects', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: 'videos/v1/source/clip.mp4',
      processingStatus: VideoProcessingStatus.UPLOADED,
    });
    (transcoder.transcode as jest.Mock).mockRejectedValue(new Error('ffmpeg binary missing'));
    prisma.video.update = jest.fn().mockResolvedValue({ id: 'v1' });

    const status = await service.processVideo('v1');

    expect(status).toBe(VideoProcessingStatus.FAILED);
    const failedData = prisma.video.update.mock.calls
      .map((c) => c[0].data)
      .find((d) => d.processingStatus === VideoProcessingStatus.FAILED);
    expect(failedData).toBeDefined();
    expect(failedData.processError).toContain('ffmpeg binary missing');
    expect(prisma.videoRendition.createMany).not.toHaveBeenCalled();
  });

  it('leaves a video without a source unchanged (no processing attempted)', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: null,
      processingStatus: null,
    });

    const status = await service.processVideo('v1');

    expect(status).toBe(VideoProcessingStatus.UPLOADED);
    expect(transcoder.transcode).not.toHaveBeenCalled();
    expect(prisma.video.update).not.toHaveBeenCalled();
  });

  it('does not re-process a video that is freshly PROCESSING', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: 'videos/v1/source/clip.mp4',
      processingStatus: VideoProcessingStatus.PROCESSING,
      updatedAt: new Date(),
    });

    const status = await service.processVideo('v1');

    expect(status).toBe(VideoProcessingStatus.PROCESSING);
    expect(transcoder.transcode).not.toHaveBeenCalled();
    expect(prisma.video.update).not.toHaveBeenCalled();
  });

  it('recovers a stale PROCESSING video, clears old artifacts, and converges to READY', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: 'videos/v1/source/clip.mp4',
      processingStatus: VideoProcessingStatus.PROCESSING,
      updatedAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    prisma.video.update = jest.fn().mockResolvedValue({ id: 'v1' });

    const status = await service.processVideo('v1');

    expect(status).toBe(VideoProcessingStatus.READY);
    expect(transcoder.transcode).toHaveBeenCalledTimes(1);

    const updates = prisma.video.update.mock.calls.map((c) => c[0].data.processingStatus);
    expect(updates).toContain(VideoProcessingStatus.READY);

    // Retry converges instead of duplicating: old rows are cleared first, and
    // the new rows are written exactly once.
    expect(
      prisma.videoRendition.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.videoRendition.createMany.mock.invocationCallOrder[0]);
    expect(prisma.videoRendition.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.videoThumbnail.createMany).toHaveBeenCalledTimes(1);
  });

  it('marks a video FAILED and sanitizes the error when a bounded operation times out', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: 'videos/v1/source/clip.mp4',
      processingStatus: VideoProcessingStatus.UPLOADED,
    });
    (transcoder.transcode as jest.Mock).mockRejectedValue(
      new Error('Bunny storage request timed out after 300000ms'),
    );
    prisma.video.update = jest.fn().mockResolvedValue({ id: 'v1' });

    const status = await service.processVideo('v1');

    expect(status).toBe(VideoProcessingStatus.FAILED);
    const failedData = prisma.video.update.mock.calls
      .map((c) => c[0].data)
      .find((d) => d.processingStatus === VideoProcessingStatus.FAILED);
    expect(failedData.processError).toContain('timed out');
  });

  describe('remote (bunny) publish of the full HLS tree', () => {
    function makeBunnyStorage() {
      return {
        name: 'bunny',
        store: jest.fn().mockResolvedValue({ provider: 'bunny', key: 'k', sizeBytes: 1 }),
        getObject: jest.fn().mockResolvedValue({ provider: 'bunny', key: 'k', sizeBytes: 1 }),
        deletePrefix: jest.fn().mockResolvedValue(undefined),
        read: jest.fn().mockResolvedValue(Buffer.from('')),
        delete: jest.fn(),
      };
    }

    function makeTree(tmp: string): TranscodeResult {
      fs.mkdirSync(path.join(tmp, 'videos/v1/hls/360p'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'videos/v1/thumbnails'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'videos/v1/hls/master.m3u8'), '#EXTM3U\n');
      fs.writeFileSync(path.join(tmp, 'videos/v1/hls/360p/index.m3u8'), '#EXTM3U\n');
      fs.writeFileSync(path.join(tmp, 'videos/v1/hls/360p/segment_0000.ts'), 'seg');
      fs.writeFileSync(path.join(tmp, 'videos/v1/thumbnails/poster.jpg'), 'jpg');

      return {
        ...readyResult,
        outputRoot: tmp,
      };
    }

    beforeEach(() => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        id: 'v1',
        sourceStorageKey: 'videos/v1/source/clip.mp4',
        processingStatus: VideoProcessingStatus.UPLOADED,
      });
      prisma.video.update = jest.fn().mockResolvedValue({ id: 'v1' });
    });

    it('uploads the complete HLS tree and persists the real provider name', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-publish-'));
      const bunnyStorage = makeBunnyStorage();
      (transcoder.transcode as jest.Mock).mockResolvedValue(makeTree(tmp));
      service = new VideoProcessingService(
        prisma as unknown as PrismaService,
        transcoder,
        transcodeConfig as never,
        bunnyStorage as never,
      );

      const status = await service.processVideo('v1');

      expect(status).toBe(VideoProcessingStatus.READY);

      const uploaded = bunnyStorage.store.mock.calls.map((c) => (c[0] as { objectPath: string }).objectPath);
      expect(uploaded.sort()).toEqual([
        'videos/v1/hls/360p/index.m3u8',
        'videos/v1/hls/360p/segment_0000.ts',
        'videos/v1/hls/master.m3u8',
        'videos/v1/thumbnails/poster.jpg',
      ]);

      // The persisted storageProvider must be the ACTIVE provider, not "local".
      const renditionData = prisma.videoRendition.createMany.mock.calls[0][0].data;
      expect(renditionData.every((r: { storageProvider: string }) => r.storageProvider === 'bunny')).toBe(true);
      const thumbData = prisma.videoThumbnail.createMany.mock.calls[0][0].data;
      expect(thumbData.every((t: { storageProvider: string }) => t.storageProvider === 'bunny')).toBe(true);

      // The local scratch workspace is removed after a successful publish.
      expect(fs.existsSync(tmp)).toBe(false);
    });

    it('cleans partial cloud prefixes and marks the video FAILED when publishing fails', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-publish-fail-'));
      const bunnyStorage = makeBunnyStorage();
      bunnyStorage.store.mockRejectedValue(new Error('upload exploded'));
      bunnyStorage.getObject.mockRejectedValue(new Error('upload exploded'));
      (transcoder.transcode as jest.Mock).mockResolvedValue(makeTree(tmp));
      service = new VideoProcessingService(
        prisma as unknown as PrismaService,
        transcoder,
        transcodeConfig as never,
        bunnyStorage as never,
      );

      const status = await service.processVideo('v1');

      expect(status).toBe(VideoProcessingStatus.FAILED);
      expect(bunnyStorage.deletePrefix).toHaveBeenCalledWith('videos/v1/hls');
      expect(bunnyStorage.deletePrefix).toHaveBeenCalledWith('videos/v1/thumbnails');
      expect(fs.existsSync(tmp)).toBe(false);
      expect(prisma.videoRendition.createMany).not.toHaveBeenCalled();
    });
  });
});