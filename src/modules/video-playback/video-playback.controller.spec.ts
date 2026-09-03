import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { VideoPlaybackController } from './video-playback.controller';
import { VideoMediaController } from './video-media.controller';
import { VideoPlaybackService } from './video-playback.service';
import { VideoMediaService } from './video-media.service';
import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('VideoPlayback E2E', () => {
  let app: INestApplication;
  let mediaRoot: string;

  const VIDEO_ID = '123e4567-e89b-12d3-a456-426614174000';

  const mockPlayback = {
    id: VIDEO_ID,
    title: 'Test Video',
    description: 'A test video',
    durationSeconds: 25.4,
    posterUrl: `/api/media/${VIDEO_ID}/thumbnails/poster.jpg`,
    hlsMasterUrl: `/api/media/${VIDEO_ID}/hls/master.m3u8`,
    processingStatus: VideoProcessingStatus.READY,
    publicationStatus: VideoStatus.PUBLISHED,
    publishedAt: '2026-01-01T00:00:00.000Z',
    availableQualities: [
      { label: '360p', width: 640, height: 360, bitrateKbps: 450 },
      { label: '720p', width: 1280, height: 720, bitrateKbps: 1500 },
    ],
    channel: { id: 'chan-1', name: 'Test Channel', slug: 'test-channel' },
  };

  const videoDir = `videos/${VIDEO_ID}`;

  beforeAll(() => {
    mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-e2e-'));

    // Create test media files.
    fs.mkdirSync(path.join(mediaRoot, `${videoDir}/hls/360p`), { recursive: true });
    fs.mkdirSync(path.join(mediaRoot, `${videoDir}/hls/720p`), { recursive: true });
    fs.mkdirSync(path.join(mediaRoot, `${videoDir}/thumbnails`), { recursive: true });

    fs.writeFileSync(
      path.join(mediaRoot, `${videoDir}/hls/master.m3u8`),
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=450000,RESOLUTION=640x360\n360p/index.m3u8\n',
    );
    fs.writeFileSync(
      path.join(mediaRoot, `${videoDir}/hls/360p/index.m3u8`),
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nsegment_0000.ts\n#EXT-X-ENDLIST\n',
    );
    fs.writeFileSync(path.join(mediaRoot, `${videoDir}/hls/360p/segment_0000.ts`), 'fake-ts-segment');
    fs.writeFileSync(
      path.join(mediaRoot, `${videoDir}/hls/720p/index.m3u8`),
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:6.0,\nsegment_0000.ts\n#EXT-X-ENDLIST\n',
    );
    fs.writeFileSync(path.join(mediaRoot, `${videoDir}/hls/720p/segment_0000.ts`), 'fake-ts-segment-720');
    fs.writeFileSync(path.join(mediaRoot, `${videoDir}/thumbnails/poster.jpg`), 'fake-jpeg');
  });

  afterAll(() => {
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const mockPlaybackService = {
      getPublicPlaybackMetadata: jest.fn().mockResolvedValue(mockPlayback),
      getPlaybackMetadata: jest.fn().mockResolvedValue(mockPlayback),
    };

    const mockMediaService = {
      resolveMediaPath: jest.fn(),
      createReadStream: (absPath: string, start?: number, end?: number) =>
        fs.createReadStream(absPath, { start, end }),
      lastRelativePath: null as string | null,
    };

    // Record the relativePath argument passed by the controller so tests can
    // assert the wildcard path is reconstructed correctly.
    (mockMediaService.resolveMediaPath as jest.Mock).mockImplementation(
      (videoId: string, rel: string) => {
        mockMediaService.lastRelativePath = rel;
        return null;
      },
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [VideoPlaybackController, VideoMediaController],
      providers: [
        { provide: VideoPlaybackService, useValue: mockPlaybackService },
        { provide: VideoMediaService, useValue: mockMediaService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const mediaPathOf = (rel: string) => path.join(mediaRoot, videoDir, rel);

  describe('GET /api/videos/:id/playback', () => {
    it('returns playback metadata', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/videos/${VIDEO_ID}/playback`)
        .expect(200);

      expect(res.body.id).toBe(VIDEO_ID);
      expect(res.body.hlsMasterUrl).toBe(`/api/media/${VIDEO_ID}/hls/master.m3u8`);
      expect(res.body.posterUrl).toBe(`/api/media/${VIDEO_ID}/thumbnails/poster.jpg`);
      expect(res.body.availableQualities).toHaveLength(2);
      expect(res.body.channel).toBeDefined();
    });

    it('returns 404 for nonexistent video', async () => {
      const playbackService = app.get(VideoPlaybackService);
      (playbackService.getPublicPlaybackMetadata as jest.Mock).mockRejectedValue(
        new NotFoundException('Video not found'),
      );

      await request(app.getHttpServer())
        .get('/api/videos/nonexistent/playback')
        .expect(404);
    });
  });

  describe('GET /api/videos/:id', () => {
    it('returns public video metadata', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/videos/${VIDEO_ID}`)
        .expect(200);

      expect(res.body.id).toBe(VIDEO_ID);
      expect(res.body.hlsMasterUrl).toBeDefined();
    });
  });

  describe('GET /api/media/:videoId/*', () => {
    it('reconstructs the correct relative media path from the URL', async () => {
      const mediaService = app.get(VideoMediaService) as unknown as {
        resolveMediaPath: jest.Mock;
        lastRelativePath: string | null;
      };
      mediaService.lastRelativePath = null;

      await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/hls/master.m3u8`)
        .expect(404);

      expect(mediaService.lastRelativePath).toBe('hls/master.m3u8');
    });

    it('reconstructs nested segment paths correctly', async () => {
      const mediaService = app.get(VideoMediaService) as unknown as {
        resolveMediaPath: jest.Mock;
        lastRelativePath: string | null;
      };
      mediaService.lastRelativePath = null;

      await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/hls/720p/segment_0000.ts`)
        .expect(404);

      expect(mediaService.lastRelativePath).toBe('hls/720p/segment_0000.ts');
    });

    it('serves HLS master playlist with correct MIME type', async () => {
      const mediaService = app.get(VideoMediaService);
      const rel = 'hls/master.m3u8';
      (mediaService.resolveMediaPath as jest.Mock).mockResolvedValue({
        absolutePath: mediaPathOf(rel),
        mimeType: 'application/vnd.apple.mpegurl',
        size: fs.statSync(mediaPathOf(rel)).size,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/${rel}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/vnd.apple.mpegurl');
      expect(res.text).toContain('#EXTM3U');
    });

    it('serves HLS segment with video/mp2t MIME type', async () => {
      const mediaService = app.get(VideoMediaService);
      const rel = 'hls/360p/segment_0000.ts';
      (mediaService.resolveMediaPath as jest.Mock).mockResolvedValue({
        absolutePath: mediaPathOf(rel),
        mimeType: 'video/mp2t',
        size: fs.statSync(mediaPathOf(rel)).size,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/${rel}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('video/mp2t');
    });

    it('serves poster thumbnail with image/jpeg MIME type', async () => {
      const mediaService = app.get(VideoMediaService);
      const rel = 'thumbnails/poster.jpg';
      (mediaService.resolveMediaPath as jest.Mock).mockResolvedValue({
        absolutePath: mediaPathOf(rel),
        mimeType: 'image/jpeg',
        size: fs.statSync(mediaPathOf(rel)).size,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/${rel}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('image/jpeg');
    });

    it('returns 404 for nonexistent media', async () => {
      const mediaService = app.get(VideoMediaService);
      (mediaService.resolveMediaPath as jest.Mock).mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/hls/nonexistent.m3u8`)
        .expect(404);
    });

    it('returns 404 for invalid video ID format', async () => {
      await request(app.getHttpServer())
        .get('/api/media/invalid-id/hls/master.m3u8')
        .expect(404);
    });

    it('rejects path traversal attempts', async () => {
      const mediaService = app.get(VideoMediaService);
      (mediaService.resolveMediaPath as jest.Mock).mockResolvedValue(null);

      await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/../../.env`)
        .expect(404);
    });

    it('sets CORS headers', async () => {
      const mediaService = app.get(VideoMediaService);
      const rel = 'hls/master.m3u8';
      (mediaService.resolveMediaPath as jest.Mock).mockResolvedValue({
        absolutePath: mediaPathOf(rel),
        mimeType: 'application/vnd.apple.mpegurl',
        size: fs.statSync(mediaPathOf(rel)).size,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/${rel}`)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('sets cache control headers', async () => {
      const mediaService = app.get(VideoMediaService);
      const rel = 'hls/master.m3u8';
      (mediaService.resolveMediaPath as jest.Mock).mockResolvedValue({
        absolutePath: mediaPathOf(rel),
        mimeType: 'application/vnd.apple.mpegurl',
        size: fs.statSync(mediaPathOf(rel)).size,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/media/${VIDEO_ID}/${rel}`)
        .expect(200);

      expect(res.headers['cache-control']).toContain('public');
    });
  });
});
