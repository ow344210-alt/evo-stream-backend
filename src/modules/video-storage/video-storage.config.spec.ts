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

  it('fails fast when the s3 provider is selected without an adapter', () => {
    expect(
      () => new VideoStorageConfig(makeConfig({ VIDEO_STORAGE_PROVIDER: 's3' })),
    ).toThrow(/not yet implemented/);
  });

  it('fails fast when bunny is selected but its environment variables are missing', () => {
    expect(
      () => new VideoStorageConfig(makeConfig({ VIDEO_STORAGE_PROVIDER: 'bunny' })),
    ).toThrow(/VIDEO_STORAGE_PROVIDER=bunny requires the following environment variables/);
    const message = (() => {
      try {
        new VideoStorageConfig(makeConfig({ VIDEO_STORAGE_PROVIDER: 'bunny' }));
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : '';
      }
    })();
    expect(message).toContain('BUNNY_STORAGE_ZONE');
    expect(message).toContain('BUNNY_STORAGE_API_KEY');
    expect(message).toContain('BUNNY_STORAGE_HOSTNAME');
    expect(message).toContain('BUNNY_PULL_ZONE_HOSTNAME');
  });

  it('lists only missing variable names for bunny and never leaks values', () => {
    let message = '';
    try {
      new VideoStorageConfig(
        makeConfig({
          VIDEO_STORAGE_PROVIDER: 'bunny',
          BUNNY_STORAGE_ZONE: 'my-zone',
          BUNNY_STORAGE_API_KEY: 'super-secret-key-value',
          BUNNY_STORAGE_HOSTNAME: 'storage.bunnycdn.com',
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('BUNNY_PULL_ZONE_HOSTNAME');
    expect(message).not.toContain('super-secret-key-value');
    expect(message).not.toContain('my-zone');
  });

  it('constructs the bunny config when all bunny variables are present', () => {
    const cfg = new VideoStorageConfig(
      makeConfig({
        VIDEO_STORAGE_PROVIDER: 'bunny',
        BUNNY_STORAGE_ZONE: 'my-zone',
        BUNNY_STORAGE_API_KEY: 'some-key',
        BUNNY_STORAGE_HOSTNAME: 'storage.bunnycdn.com',
        BUNNY_PULL_ZONE_HOSTNAME: 'my-zone.b-cdn.net',
      }),
    );
    expect(cfg.provider).toBe('bunny');
    expect(cfg.localStoragePath).toBe('');
    expect(cfg.bunnyStorageZone).toBe('my-zone');
    expect(cfg.bunnyStorageApiKey).toBe('some-key');
    expect(cfg.bunnyStorageHostname).toBe('storage.bunnycdn.com');
    expect(cfg.bunnyPullZoneHostname).toBe('my-zone.b-cdn.net');
  });

  it('rejects bunny hostnames that contain a scheme or path', () => {
    expect(
      () =>
        new VideoStorageConfig(
          makeConfig({
            VIDEO_STORAGE_PROVIDER: 'bunny',
            BUNNY_STORAGE_ZONE: 'my-zone',
            BUNNY_STORAGE_API_KEY: 'k',
            BUNNY_STORAGE_HOSTNAME: 'https://storage.bunnycdn.com',
            BUNNY_PULL_ZONE_HOSTNAME: 'my-zone.b-cdn.net',
          }),
        ),
    ).toThrow(/BUNNY_STORAGE_HOSTNAME/);
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