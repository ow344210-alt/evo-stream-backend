import { VideoProcessingStatus } from '@prisma/client';
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

    service = new VideoProcessingService(
      prisma as unknown as PrismaService,
      transcoder,
      transcodeConfig as never,
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

  it('does not re-process a video that is already PROCESSING', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: 'videos/v1/source/clip.mp4',
      processingStatus: VideoProcessingStatus.PROCESSING,
    });

    const status = await service.processVideo('v1');

    expect(status).toBe(VideoProcessingStatus.PROCESSING);
    expect(transcoder.transcode).not.toHaveBeenCalled();
  });
});