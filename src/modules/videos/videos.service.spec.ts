import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VideoProcessingStatus, VideoStatus } from '@prisma/client';
import { VideosService, UploadSourceFile } from './videos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoStorageProvider } from '../video-storage/video-storage.types';
import { VideoUploadPolicy } from '../video-storage/video-storage.config';
import { VideoProcessingQueue } from '../video-processing/video-processing.queue';

const POLICY = new VideoUploadPolicy(1000, ['video/mp4', 'video/webm']);

describe('VideosService', () => {
  let service: VideosService;
  let prisma: {
    creatorProfile: { findUnique: jest.Mock };
    category: { findUnique: jest.Mock };
    video: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
  };
  let storage: {
    store: jest.Mock;
    delete: jest.Mock;
    getObject: jest.Mock;
  };
  let queue: { enqueue: jest.Mock };

  const ownVideo = {
    id: 'v1',
    channelId: 'chan-1',
    title: 'T',
    status: VideoStatus.DRAFT,
    publishedAt: null,
    sourceStorageKey: null,
    category: null,
    channel: { id: 'chan-1', name: 'N', slug: 'n' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      creatorProfile: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1', channel: { id: 'chan-1' } }) },
      category: { findUnique: jest.fn().mockResolvedValue(null) },
      video: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    } as unknown as typeof prisma;

    storage = {
      store: jest.fn(),
      delete: jest.fn(),
      getObject: jest.fn(),
    };
    queue = { enqueue: jest.fn() };

    service = new VideosService(
      prisma as unknown as PrismaService,
      storage as unknown as VideoStorageProvider,
      POLICY,
      queue as unknown as VideoProcessingQueue,
    );
  });

  const makeFile = (overrides: Partial<UploadSourceFile> = {}): UploadSourceFile => ({
    originalName: 'clip.mp4',
    mimeType: 'video/mp4',
    size: 100,
    buffer: Buffer.from('video-bytes'),
    ...overrides,
  });

  it('requires a channel before a creator can create a video', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue({ userId: 'u1', channel: null });
    await expect(
      service.createOwn('u1', { title: 'T', status: VideoStatus.DRAFT }),
    ).rejects.toThrow(BadRequestException);
  });

  it('sets publishedAt when creating a PUBLISHED video', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue({ userId: 'u1', channel: { id: 'chan-1' } });
    prisma.video.create = jest.fn().mockResolvedValue({ id: 'v1', title: 'T' });

    await service.createOwn('u1', { title: 'T', status: VideoStatus.PUBLISHED });

    expect(prisma.video.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channelId: 'chan-1',
          status: VideoStatus.PUBLISHED,
          publishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('derives the channel solely from the JWT user (never from client)', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue({ userId: 'u1', channel: { id: 'chan-1' } });
    prisma.video.create = jest.fn().mockResolvedValue({ id: 'v1' });

    await service.createOwn('u1', { title: 'T' });

    const callData = (prisma.video.create as jest.Mock).mock.calls[0][0].data;
    expect(callData.channelId).toBe('chan-1');
  });

  it('rejects creating a video for a channel that does not belong to the creator', async () => {
    prisma.creatorProfile.findUnique = jest.fn().mockResolvedValue({ userId: 'u1', channel: { id: 'chan-1' } });
    prisma.video.findFirst = jest.fn().mockResolvedValue(null);

    await expect(service.getOwn('u1', 'other-video')).rejects.toThrow(NotFoundException);
    expect(prisma.video.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'other-video', channelId: 'chan-1' } }),
    );
  });

  it('throws NotFoundException when admin updates a missing video', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue(null);
    await expect(
      service.adminUpdateStatus('nope', VideoStatus.PUBLISHED),
    ).rejects.toThrow(NotFoundException);
  });

  // ---- Real source upload ----

  it('stores an uploaded source through the provider abstraction and persists metadata', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue({ ...ownVideo, status: VideoStatus.DRAFT });
    prisma.video.update = jest.fn().mockResolvedValue({
      ...ownVideo,
      processingStatus: VideoProcessingStatus.UPLOADED,
    });
    storage.store = jest.fn().mockResolvedValue({
      provider: 'local',
      key: 'videos/v1/source/clip.mp4',
      originalName: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 100,
    });

    const result = await service.uploadSource('u1', 'v1', makeFile());

    expect(storage.store).toHaveBeenCalledWith(
      expect.objectContaining({
        objectPath: 'videos/v1/source/clip.mp4',
        mimeType: 'video/mp4',
        originalName: 'clip.mp4',
      }),
    );
    expect(prisma.video.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceStorageProvider: 'local',
          sourceStorageKey: 'videos/v1/source/clip.mp4',
          sourceMimeType: 'video/mp4',
          sourceFileSize: 100,
          processingStatus: VideoProcessingStatus.UPLOADED,
        }),
      }),
    );
    expect(result.processingStatus).toBe(VideoProcessingStatus.UPLOADED);
    expect(queue.enqueue).toHaveBeenCalledWith('v1');
  });

  it('requires a file: rejects missing file', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue(ownVideo);
    await expect(service.uploadSource('u1', 'v1', null)).rejects.toThrow(BadRequestException);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('rejects an unsupported MIME type', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue(ownVideo);
    await expect(service.uploadSource('u1', 'v1', makeFile({ mimeType: 'text/html' }))).rejects.toThrow(
      BadRequestException,
    );
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('rejects an oversized file', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue(ownVideo);
    await expect(service.uploadSource('u1', 'v1', makeFile({ buffer: Buffer.alloc(2000) }))).rejects.toThrow(
      /exceeds configured limit/,
    );
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('rejects an empty file buffer', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue(ownVideo);
    await expect(service.uploadSource('u1', 'v1', makeFile({ buffer: Buffer.alloc(0) }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('cannot upload to another creators video (ownership)', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue(null);
    await expect(service.uploadSource('u1', 'foreign-video', makeFile())).rejects.toThrow(NotFoundException);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('cleans up the stored source when DB persistence fails after storage', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue({ ...ownVideo });
    prisma.video.update = jest.fn().mockRejectedValue(new Error('db down'));
    storage.store = jest.fn().mockResolvedValue({
      provider: 'local',
      key: 'videos/v1/source/clip.mp4',
      sizeBytes: 100,
    });

    await expect(service.uploadSource('u1', 'v1', makeFile())).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalledWith('videos/v1/source/clip.mp4');
  });

  it('does not leave an orphan when storage itself fails', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue({ ...ownVideo });
    storage.store = jest.fn().mockRejectedValue(new Error('storage down'));
    await expect(service.uploadSource('u1', 'v1', makeFile())).rejects.toThrow(BadRequestException);
    expect(prisma.video.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceStorageProvider: expect.anything() }) }),
    );
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('applies optional metadata edits on upload without erasing source fields', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue({ ...ownVideo });
    prisma.video.update = jest
      .fn()
      .mockResolvedValueOnce({ ...ownVideo, title: 'New Title' })
      .mockResolvedValueOnce({ ...ownVideo, processingStatus: VideoProcessingStatus.UPLOADED });
    storage.store = jest.fn().mockResolvedValue({ provider: 'local', key: 'k', sizeBytes: 100 });

    await service.uploadSource('u1', 'v1', makeFile(), { title: 'New Title' });

    expect(prisma.video.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'New Title' }) }),
    );
  });

  // ---- Delete / hide ----

  it('delete cleans up the associated source object after DB delete', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue({
      ...ownVideo,
      sourceStorageKey: 'videos/v1/source/clip.mp4',
    });
    prisma.video.delete = jest.fn().mockResolvedValue({ id: 'v1' });

    await service.removeOwn('u1', 'v1');

    expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
    expect(storage.delete).toHaveBeenCalledWith('videos/v1/source/clip.mp4');
  });

  it('delete does not attempt storage cleanup when no source exists', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue({ ...ownVideo, sourceStorageKey: null });
    prisma.video.delete = jest.fn().mockResolvedValue({ id: 'v1' });

    await service.removeOwn('u1', 'v1');

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('hiding a video does NOT delete its source object', async () => {
    prisma.video.findUnique = jest.fn().mockResolvedValue({
      id: 'v1',
      sourceStorageKey: 'videos/v1/source/clip.mp4',
    });
    prisma.video.update = jest.fn().mockResolvedValue({ id: 'v1', status: VideoStatus.HIDDEN });

    await service.adminUpdateStatus('v1', VideoStatus.HIDDEN);

    expect(storage.delete).not.toHaveBeenCalled();
    expect(prisma.video.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: VideoStatus.HIDDEN }) }),
    );
  });

  it('metadata update preserves source fields', async () => {
    prisma.video.findFirst = jest.fn().mockResolvedValue({
      ...ownVideo,
      sourceStorageKey: 'videos/v1/source/clip.mp4',
      sourceMimeType: 'video/mp4',
    });
    prisma.video.update = jest.fn().mockResolvedValue({ id: 'v1', title: 'Renamed' });

    await service.updateOwn('u1', 'v1', { title: 'Renamed' });

    const updateData = (prisma.video.update as jest.Mock).mock.calls[0][0].data;
    expect(updateData).toEqual({ title: 'Renamed' });
    expect(updateData.sourceStorageKey).toBeUndefined();
    expect(updateData.sourceMimeType).toBeUndefined();
  });
});