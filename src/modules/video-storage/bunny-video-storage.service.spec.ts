import {
  BunnyStorageConfig,
  BunnyVideoStorageService,
} from './bunny-video-storage.service';

const CONFIG: BunnyStorageConfig = {
  storageZone: 'evo-zone',
  apiKey: 'super-secret-api-key',
  storageHost: 'storage.bunnycdn.com',
  pullZoneHostname: 'evo-zone.b-cdn.net',
};

function httpResponse(
  body: string = '',
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

describe('BunnyVideoStorageService', () => {
  let service: BunnyVideoStorageService;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new BunnyVideoStorageService(CONFIG);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('store', () => {
    it('uploads a buffer via PUT with the auth header and returns metadata', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 201));
      const data = Buffer.from('source-bytes');

      const meta = await service.store({
        buffer: data,
        objectPath: 'videos/v1/source/clip.mp4',
        mimeType: 'video/mp4',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://storage.bunnycdn.com/evo-zone/videos/v1/source/clip.mp4');
      expect(init.method).toBe('PUT');
      expect(init.headers).toMatchObject({
        AccessKey: 'super-secret-api-key',
        'Content-Type': 'video/mp4',
      });
      expect(meta).toMatchObject({
        provider: 'bunny',
        key: 'videos/v1/source/clip.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 12,
      });
    });

    it('sends the credential unprefixed as AccessKey (no Bearer)', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 201));

      await service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/source/a.mp4' });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.AccessKey).toBe(CONFIG.apiKey);
      expect(init.headers.AccessKey).not.toMatch(/^Bearer\s/i);
      expect(init.headers).not.toHaveProperty('Authorization');
    });

    it('infers Content-Type from the object extension', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 201));

      await service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/hls/master.m3u8' });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers['Content-Type']).toBe('application/vnd.apple.mpegurl');
    });

    it('maps TS segments and JPEG posters to the correct content types', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 201));

      await service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/hls/720p/segment_0000.ts' });
      await service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/thumbnails/poster.jpg' });

      expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('video/mp2t');
      expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('image/jpeg');
    });

    it('preserves nested object paths in the storage URL', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 201));

      await service.store({
        buffer: Buffer.from('x'),
        objectPath: 'videos/v1/hls/360p/index.m3u8',
      });

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://storage.bunnycdn.com/evo-zone/videos/v1/hls/360p/index.m3u8',
      );
    });

    it('rejects path traversal object paths without calling the API', async () => {
      await expect(
        service.store({ buffer: Buffer.from('x'), objectPath: '../escape.mp4' }),
      ).rejects.toThrow(/traversal/i);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws on non-2xx responses without leaking the API key', async () => {
      fetchMock.mockResolvedValue(httpResponse('nope', 500));

      const error = await service
        .store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/source/x' })
        .then(() => null, (e: Error) => e);

      expect(error?.message).toContain('HTTP 500');
      expect(error?.message).not.toContain('super-secret-api-key');
    });
  });

  describe('read', () => {
    it('returns the object bytes', async () => {
      fetchMock.mockResolvedValue(httpResponse('abc123'));

      await expect(service.read('videos/v1/source/main')).resolves.toEqual(Buffer.from('abc123'));
    });

    it('throws when the object is missing (404)', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 404));

      await expect(service.read('videos/v1/source/missing')).rejects.toThrow(/HTTP 404/);
    });
  });

  describe('getObject', () => {
    it('returns null for a missing object', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 404));

      expect(await service.getObject('videos/v1/hls/master.m3u8')).toBeNull();
    });

    it('returns metadata with size parsed from Content-Range', async () => {
      fetchMock.mockResolvedValue(
        httpResponse('', 206, { 'Content-Range': 'bytes 0-0/48912' }),
      );

      const obj = await service.getObject('videos/v1/hls/master.m3u8');

      expect(obj).toMatchObject({
        provider: 'bunny',
        key: 'videos/v1/hls/master.m3u8',
        sizeBytes: 48912,
      });
    });
  });

  describe('delete / deletePrefix', () => {
    it('deletes a single object on 2xx', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 200));

      await expect(service.delete('videos/v1/hls/master.m3u8')).resolves.toBeUndefined();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://storage.bunnycdn.com/evo-zone/videos/v1/hls/master.m3u8');
      expect(init.method).toBe('DELETE');
    });

    it('treats deleting a missing object (404) as a no-op', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 404));

      await expect(service.delete('videos/v1/hls/ghost.m3u8')).resolves.toBeUndefined();
    });

    it('deletes an entire prefix (folder subtree) via DELETE', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 200));

      await expect(service.deletePrefix('videos/v1')).resolves.toBeUndefined();

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://storage.bunnycdn.com/evo-zone/videos/v1',
      );
      expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });

    it('treats deleting a missing prefix (404) as a no-op', async () => {
      fetchMock.mockResolvedValue(httpResponse('', 404));

      await expect(service.deletePrefix('videos/ghost')).resolves.toBeUndefined();
    });
  });

  describe('bounded requests', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('attaches an abort signal to every storage operation', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(httpResponse('', 201)));

      await service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/source/x.mp4' });
      await service.read('videos/v1/source/x.mp4');
      await service.getObject('videos/v1/hls/master.m3u8');
      await service.delete('videos/v1/hls/master.m3u8');
      await service.deletePrefix('videos/v1');

      expect(fetchMock.mock.calls.length).toBe(5);
      for (const call of fetchMock.mock.calls) {
        expect(call[1].signal).toBeInstanceOf(AbortSignal);
      }
    });

    it('aborts a hung request and reports a sanitized timeout', async () => {
      jest.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
            );
          }),
      );

      const promise = service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/source/x.mp4' });
      jest.advanceTimersByTime(5 * 60 * 1000);

      const error = await promise.then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(error?.message).toContain('timed out');
      expect(error?.message).not.toContain('super-secret-api-key');
    });

    it('surfaces non-timeout errors unchanged', async () => {
      fetchMock.mockRejectedValue(new Error('socket hang up'));

      await expect(
        service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v1/source/x.mp4' }),
      ).rejects.toThrow('socket hang up');
    });
  });

  describe('getPublicUrl', () => {
    it('returns an absolute CDN URL from the pull zone hostname', () => {
      expect(service.getPublicUrl('videos/v1/hls/master.m3u8')).toBe(
        'https://evo-zone.b-cdn.net/videos/v1/hls/master.m3u8',
      );
      expect(service.getPublicUrl('videos/v1/thumbnails/poster.jpg')).toBe(
        'https://evo-zone.b-cdn.net/videos/v1/thumbnails/poster.jpg',
      );
    });

    it('returns null when no pull zone hostname is configured', () => {
      const noCdn = new BunnyVideoStorageService({ ...CONFIG, pullZoneHostname: null });
      expect(noCdn.getPublicUrl('videos/v1/hls/master.m3u8')).toBeNull();
    });
  });
});