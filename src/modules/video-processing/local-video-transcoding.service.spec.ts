import { execFile } from 'child_process';
import { LocalVideoTranscodingService } from './local-video-transcoding.service';

jest.mock('child_process', () => ({ execFile: jest.fn() }));

const execFileMock = execFile as unknown as jest.Mock;

type Callback = (error: Error | null, output: unknown, unused?: unknown) => void;

const STDOUT = (value: string) => ({ stdout: value, stderr: '' });

function makeService() {
  const storage = {
    name: 'bunny',
    read: jest.fn().mockResolvedValue(Buffer.from('source-bytes')),
  };
  const service = new LocalVideoTranscodingService(
    { localStoragePath: '' } as never,
    {
      resolveFfmpeg: () => '/usr/bin/ffmpeg',
      resolveFfprobe: () => '/usr/bin/ffprobe',
    } as never,
    storage as never,
  );
  return { service, storage };
}

const OPTIONS = {
  sourceKey: 'videos/v1/source/clip.mp4',
  outputPrefix: 'videos/v1/hls',
  thumbnailPrefix: 'videos/v1/thumbnails',
  renditions: [
    { label: '720p', height: 720, width: 1280, videoBitrate: 1_500_000, audioBitrate: 128_000 },
  ],
  posterAtSeconds: 5,
};

describe('LocalVideoTranscodingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs ffprobe then ffmpeg with bounded timeouts, and returns the artifact keys', async () => {
    const captured: Array<{ cmd: string; args: string[]; options: Record<string, unknown> }> = [];
    const behaviors = [
      (cb: Callback) => cb(null, STDOUT('123.4\n')),
      (cb: Callback) => cb(null, STDOUT('')),
      (cb: Callback) => cb(null, STDOUT('')),
    ];
    execFileMock.mockImplementation(
      (cmd: string, args: string[], options: Record<string, unknown>, callback: Callback) => {
        captured.push({ cmd, args, options });
        behaviors.shift()!(callback);
      },
    );

    const { service, storage } = makeService();
    const result = await service.transcode(OPTIONS);

    expect(captured.map((c) => c.cmd)).toEqual([
      '/usr/bin/ffprobe',
      '/usr/bin/ffmpeg',
      '/usr/bin/ffmpeg',
    ]);

    // ffprobe gets a fixed, short ceiling.
    expect(captured[0].options.timeout).toBe(30_000);
    // ffmpeg rendition gets a duration-aware ceiling (123.4s source -> clamps to the 15m floor).
    expect(captured[1].options.timeout).toBe(15 * 60 * 1000);
    // poster gets the fixed floor ceiling.
    expect(captured[2].options.timeout).toBe(15 * 60 * 1000);
    // poster extraction passes -update 1 for clean single-frame extraction.
    expect(captured[2].args).toEqual(
      expect.arrayContaining(['-frames:v', '1', '-update', '1']),
    );
    // every child extends the abort window and is hard-killed on timeout.
    for (const call of captured) {
      expect(call.options.timeout).toBeDefined();
      expect(call.options.killSignal).toBe('SIGKILL');
    }

    expect(storage.read).toHaveBeenCalledWith('videos/v1/source/clip.mp4');
    expect(result.masterPlaylistKey).toBe('videos/v1/hls/master.m3u8');
    expect(result.durationSeconds).toBe(123.4);
    expect(result.renditions).toHaveLength(1);
    expect(result.renditions[0].playlistKey).toBe('videos/v1/hls/720p/index.m3u8');
    expect(result.thumbnails[0].key).toBe('videos/v1/thumbnails/poster.jpg');
  });

  it('scales the rendition timeout for long-form sources and never exceeds the hard cap', async () => {
    const captured: Array<{ cmd: string; options: Record<string, unknown> }> = [];
    const behaviors = [
      (cb: Callback) => cb(null, STDOUT('7200\n')),
      (cb: Callback) => cb(null, STDOUT('')),
      (cb: Callback) => cb(null, STDOUT('')),
    ];
    execFileMock.mockImplementation(
      (cmd: string, _args: unknown, options: Record<string, unknown>, callback: Callback) => {
        captured.push({ cmd, options });
        behaviors.shift()!(callback);
      },
    );

    const { service } = makeService();
    await service.transcode(OPTIONS);

    // 7200s * 5 = 10h, capped at 3h.
    expect(captured[1].options.timeout).toBe(3 * 60 * 60 * 1000);
  });

  it('propagates an ffprobe timeout as a surfaced error instead of hanging', async () => {
    const behaviors = [
      (cb: Callback) => cb(Object.assign(new Error('Command failed: ffprobe ... timed out'), { killed: true }), null),
    ];
    execFileMock.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, callback: Callback) => {
      behaviors.shift()!(callback);
    });

    const { service } = makeService();

    await expect(service.transcode(OPTIONS)).rejects.toThrow(/timed out/);
  });

  it('propagates an ffmpeg rendition timeout as a surfaced error instead of hanging', async () => {
    const behaviors = [
      (cb: Callback) => cb(null, STDOUT('10\n')),
      (cb: Callback) => cb(Object.assign(new Error('Command failed: ffmpeg ... timed out'), { killed: true }), null),
    ];
    execFileMock.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, callback: Callback) => {
      behaviors.shift()!(callback);
    });

    const { service } = makeService();

    await expect(service.transcode(OPTIONS)).rejects.toThrow(/timed out/);
  });
});