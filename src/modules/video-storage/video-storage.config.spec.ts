import { ConfigService } from '@nestjs/config';
import { VideoStorageConfig, VideoUploadPolicy } from './video-storage.config';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('VideoStorageConfig', () => {
  it('defaults to the local provider with a valid storage root', () => {
    const cfg = new VideoStorageConfig(makeConfig({}));
    expect(cfg.provider).toBe('local');
    expect(cfg.localStoragePath).toBeTruthy();
    expect(cfg.maxUploadBytes).toBeGreaterThan(0);
    expect(cfg.acceptedVideoMimeTypes.length).toBeGreaterThan(0);
  });

  it('reads the configured provider and local path', () => {
    const cfg = new VideoStorageConfig(
      makeConfig({ VIDEO_STORAGE_PROVIDER: 'local', VIDEO_LOCAL_STORAGE_PATH: 'runtime-uploads' }),
    );
    expect(cfg.provider).toBe('local');
    expect(cfg.localStoragePath.endsWith('runtime-uploads')).toBe(true);
    expect(cfg.localStoragePath).toContain('runtime-uploads');
  });

  it('fails clearly on an unsupported provider', () => {
    expect(
      () => new VideoStorageConfig(makeConfig({ VIDEO_STORAGE_PROVIDER: 'ftp' })),
    ).toThrow(/Unsupported VIDEO_STORAGE_PROVIDER/);
  });

  it('fails fast when a production provider is selected without an adapter', () => {
    for (const provider of ['s3', 'bunny']) {
      expect(
        () => new VideoStorageConfig(makeConfig({ VIDEO_STORAGE_PROVIDER: provider })),
      ).toThrow(/not yet implemented/);
    }
  });

  it('fails clearly on an invalid local path containing null bytes', () => {
    expect(
      () =>
        new VideoStorageConfig(
          makeConfig({ VIDEO_STORAGE_PROVIDER: 'local', VIDEO_LOCAL_STORAGE_PATH: 'bad\u0000path' }),
        ),
    ).toThrow(/null characters/);
  });

  it('parses a valid max upload bytes value', () => {
    const cfg = new VideoStorageConfig(makeConfig({ VIDEO_MAX_UPLOAD_BYTES: '524288000' }));
    expect(cfg.maxUploadBytes).toBe(524288000);
  });

  it('fails clearly on an invalid max upload bytes value', () => {
    expect(
      () => new VideoStorageConfig(makeConfig({ VIDEO_MAX_UPLOAD_BYTES: 'not-a-number' })),
    ).toThrow(/Invalid VIDEO_MAX_UPLOAD_BYTES/);
    expect(
      () => new VideoStorageConfig(makeConfig({ VIDEO_MAX_UPLOAD_BYTES: '-5' })),
    ).toThrow(/Invalid VIDEO_MAX_UPLOAD_BYTES/);
  });

  it('parses accepted video MIME types', () => {
    const cfg = new VideoStorageConfig(
      makeConfig({ VIDEO_ACCEPTED_MIME_TYPES: ' video/mp4 , video/webm ' }),
    );
    expect(cfg.acceptedVideoMimeTypes).toEqual(['video/mp4', 'video/webm']);
  });
});

describe('VideoUploadPolicy', () => {
  const policy = new VideoUploadPolicy(1000, ['video/mp4', 'video/webm']);

  it('accepts an in-limit size and known MIME type', () => {
    expect(policy.isAcceptedSize(500)).toBe(true);
    expect(policy.isAcceptedMimeType('video/mp4')).toBe(true);
  });

  it('rejects oversized uploads', () => {
    expect(policy.isAcceptedSize(1001)).toBe(false);
    expect(() => policy.validate(2000, 'video/mp4')).toThrow(/exceeds configured limit/);
  });

  it('rejects unknown or missing MIME types', () => {
    expect(policy.isAcceptedMimeType('text/html')).toBe(false);
    expect(policy.isAcceptedMimeType(undefined)).toBe(false);
    expect(() => policy.validate(10, 'application/x-msdownload')).toThrow(/not accepted/);
  });

  it('rejects zero-size uploads', () => {
    expect(policy.isAcceptedSize(0)).toBe(false);
  });

  it('is case-insensitive for MIME types', () => {
    expect(policy.isAcceptedMimeType('VIDEO/MP4')).toBe(true);
  });
});