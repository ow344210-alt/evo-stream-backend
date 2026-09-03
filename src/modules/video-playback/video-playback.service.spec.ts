import { NotFoundException } from '@nestjs/common';
import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import { VideoPlaybackService } from './video-playback.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('VideoPlaybackService', () => {
  let service: VideoPlaybackService;
  let prisma: {
    video: { findUnique: jest.Mock };
  };

  const readyPublishedVideo = {
    id: 'v1',
    title: 'Test Video',
    description: 'A test video',
    durationSeconds: 25.4,
    posterThumbnailKey: 'videos/v1/thumbnails/poster.jpg',
    hlsMasterKey: 'videos/v1/hls/master.m3u8',
    processingStatus: VideoProcessingStatus.READY,
    status: VideoStatus.PUBLISHED,
    publishedAt: new Date('2026-01-01'),
    channel: { id: 'chan-1', name: 'Test Channel', slug: 'test-channel' },
    renditions: [
      { label: '360p', width: 640, height: 360, bitrateKbps: 450 },
      { label: '480p', width: 854, height: 480, bitrateKbps: 800 },
      { label: '720p', width: 1280, height: 720, bitrateKbps: 1500 },
      { label: '1080p', width: 1920, height: 1080, bitrateKbps: 2800 },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      video: { findUnique: jest.fn() },
    };
    service = new VideoPlaybackService(
      prisma as unknown as PrismaService,
    );
  });

  describe('getPlaybackMetadata', () => {
    it('returns full playback metadata for a READY+PUBLISHED video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');

      expect(result.id).toBe('v1');
      expect(result.title).toBe('Test Video');
      expect(result.description).toBe('A test video');
      expect(result.durationSeconds).toBe(25.4);
      expect(result.processingStatus).toBe(VideoProcessingStatus.READY);
      expect(result.publicationStatus).toBe(VideoStatus.PUBLISHED);
      expect(result.publishedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns correct HLS master URL', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');

      expect(result.hlsMasterUrl).toBe('/api/media/v1/hls/master.m3u8');
    });

    it('returns correct poster URL', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');

      expect(result.posterUrl).toBe('/api/media/v1/thumbnails/poster.jpg');
    });

    it('returns actual generated rendition qualities', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');

      expect(result.availableQualities).toHaveLength(4);
      expect(result.availableQualities[0]).toEqual({
        label: '360p',
        width: 640,
        height: 360,
        bitrateKbps: 450,
      });
      expect(result.availableQualities[3]).toEqual({
        label: '1080p',
        width: 1920,
        height: 1080,
        bitrateKbps: 2800,
      });
    });

    it('returns channel info', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');

      expect(result.channel).toEqual({
        id: 'chan-1',
        name: 'Test Channel',
        slug: 'test-channel',
      });
    });

    it('returns null posterUrl when no posterThumbnailKey', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        posterThumbnailKey: null,
      });

      const result = await service.getPlaybackMetadata('v1');
      expect(result.posterUrl).toBeNull();
    });

    it('returns null hlsMasterUrl when no hlsMasterKey', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        hlsMasterKey: null,
      });

      const result = await service.getPlaybackMetadata('v1');
      expect(result.hlsMasterUrl).toBeNull();
    });

    it('returns empty qualities when no renditions generated', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        renditions: [],
      });

      const result = await service.getPlaybackMetadata('v1');
      expect(result.availableQualities).toHaveLength(0);
    });

    it('returns fewer qualities when not all renditions were generated', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        renditions: [
          { label: '360p', width: 640, height: 360, bitrateKbps: 450 },
          { label: '720p', width: 1280, height: 720, bitrateKbps: 1500 },
        ],
      });

      const result = await service.getPlaybackMetadata('v1');
      expect(result.availableQualities).toHaveLength(2);
      expect(result.availableQualities.map(q => q.label)).toEqual(['360p', '720p']);
    });

    it('throws NotFoundException for nonexistent video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(null);

      await expect(service.getPlaybackMetadata('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublicPlaybackMetadata', () => {
    it('returns metadata for READY+PUBLISHED video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPublicPlaybackMetadata('v1');
      expect(result.id).toBe('v1');
      expect(result.hlsMasterUrl).toBe('/api/media/v1/hls/master.m3u8');
    });

    it('throws NotFoundException for PROCESSING video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        processingStatus: VideoProcessingStatus.PROCESSING,
      });

      await expect(service.getPublicPlaybackMetadata('v1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for FAILED video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        processingStatus: VideoProcessingStatus.FAILED,
      });

      await expect(service.getPublicPlaybackMetadata('v1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for UPLOADED video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        processingStatus: VideoProcessingStatus.UPLOADED,
      });

      await expect(service.getPublicPlaybackMetadata('v1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for DRAFT video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        status: VideoStatus.DRAFT,
      });

      await expect(service.getPublicPlaybackMetadata('v1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for HIDDEN video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        status: VideoStatus.HIDDEN,
      });

      await expect(service.getPublicPlaybackMetadata('v1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for nonexistent video', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(null);

      await expect(service.getPublicPlaybackMetadata('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('does not expose internal processing errors', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        processError: 'ffmpeg crashed',
      });

      const result = await service.getPublicPlaybackMetadata('v1');
      expect(result).not.toHaveProperty('processError');
    });

    it('does not expose source storage information', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        sourceStorageKey: 'videos/v1/source/secret.mp4',
        sourceStorageProvider: 'local',
        sourceOriginalName: 'secret.mp4',
      });

      const result = await service.getPublicPlaybackMetadata('v1');
      expect(result).not.toHaveProperty('sourceStorageKey');
      expect(result).not.toHaveProperty('sourceStorageProvider');
      expect(result).not.toHaveProperty('sourceOriginalName');
    });

    it('does not expose processError in metadata response', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue({
        ...readyPublishedVideo,
        processError: 'some internal error',
      });

      const result = await service.getPublicPlaybackMetadata('v1');
      const keys = Object.keys(result);
      expect(keys).not.toContain('processError');
      expect(keys).not.toContain('sourceStorageKey');
    });
  });

  describe('URL construction', () => {
    it('strips videos/{id}/ prefix correctly for HLS master', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');
      expect(result.hlsMasterUrl).toBe('/api/media/v1/hls/master.m3u8');
    });

    it('strips videos/{id}/ prefix correctly for poster', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');
      expect(result.posterUrl).toBe('/api/media/v1/thumbnails/poster.jpg');
    });

    it('no Windows filesystem paths in response', async () => {
      prisma.video.findUnique = jest.fn().mockResolvedValue(readyPublishedVideo);

      const result = await service.getPlaybackMetadata('v1');
      const responseStr = JSON.stringify(result);
      expect(responseStr).not.toMatch(/[A-Z]:\\/);
      expect(responseStr).not.toContain('backend');
      expect(responseStr).not.toContain('storage');
    });
  });
});
