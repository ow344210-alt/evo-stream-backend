import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalVideoStorageService } from './local-video-storage.service';

describe('LocalVideoStorageService', () => {
  let root: string;
  let service: LocalVideoStorageService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-storage-'));
    service = new LocalVideoStorageService(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates the storage directory when instantiated', () => {
    expect(fs.existsSync(root)).toBe(true);
  });

  it('stores a buffer and returns provider-safe metadata', async () => {
    const data = Buffer.from('hello-evo');
    const meta = await service.store({
      buffer: data,
      objectPath: 'videos/vid-123/source/main.mp4',
      mimeType: 'video/mp4',
      originalName: 'My 4K Trailer.mp4',
    });

    expect(meta.provider).toBe('local');
    expect(meta.key).toBe('videos/vid-123/source/main.mp4');
    expect(meta.sizeBytes).toBe(data.length);
    expect(meta.mimeType).toBe('video/mp4');
    expect(meta.originalName).toBe('My 4K Trailer.mp4');

    const absolute = path.join(root, 'videos', 'vid-123', 'source', 'main.mp4');
    expect(fs.readFileSync(absolute).toString()).toBe('hello-evo');
  });

  it('stores nested paths and creates intermediate directories', async () => {
    await service.store({
      buffer: Buffer.from('x'),
      objectPath: 'a/b/c/d.mp4',
    });
    expect(fs.existsSync(path.join(root, 'a', 'b', 'c', 'd.mp4'))).toBe(true);
  });

  it('is idempotent on re-running ensureRoot', () => {
    expect(() => service.ensureRoot()).not.toThrow();
  });

  it('getObject returns metadata for an existing object', async () => {
    await service.store({ buffer: Buffer.from('abc'), objectPath: 'videos/v1/source/main' });
    const meta = await service.getObject('videos/v1/source/main');
    expect(meta).not.toBeNull();
    expect(meta?.key).toBe('videos/v1/source/main');
    expect(meta?.sizeBytes).toBe(3);
  });

  it('getObject returns null for a missing object', async () => {
    expect(await service.getObject('never/exists')).toBeNull();
  });

  it('deletes an existing object', async () => {
    await service.store({ buffer: Buffer.from('abc'), objectPath: 'videos/v1/source/main' });
    await service.delete('videos/v1/source/main');
    expect(fs.existsSync(path.join(root, 'videos', 'v1', 'source', 'main'))).toBe(false);
  });

  it('deleting a missing object is a defined no-op (does not throw)', async () => {
    await expect(service.delete('does/not/exist')).resolves.toBeUndefined();
  });

  it('deletes a directory tree for a folder-like key', async () => {
    await service.store({ buffer: Buffer.from('a'), objectPath: 'videos/v1/source/s1' });
    await service.store({ buffer: Buffer.from('b'), objectPath: 'videos/v1/source/s2' });
    await service.delete('videos/v1');
    expect(fs.existsSync(path.join(root, 'videos', 'v1'))).toBe(false);
  });

  it('rejects path traversal attempts via ".."', async () => {
    await expect(
      service.store({ buffer: Buffer.from('x'), objectPath: '../escape.mp4' }),
    ).rejects.toThrow(/traversal/i);
    await expect(
      service.store({ buffer: Buffer.from('x'), objectPath: 'a/../../escape.mp4' }),
    ).rejects.toThrow(/traversal/i);
    expect(fs.existsSync(path.join(root, '..', 'escape.mp4'))).toBe(false);
  });

  it('rejects absolute-path object keys and windows-style traversal', async () => {
    await expect(
      service.store({ buffer: Buffer.from('x'), objectPath: 'C:\\Windows\\evil.mp4' }),
    ).rejects.toThrow();
    await expect(
      service.store({ buffer: Buffer.from('x'), objectPath: '..\\..\\evil.mp4' }),
    ).rejects.toThrow(/traversal/i);
  });

  it('rejects empty object keys', async () => {
    await expect(service.store({ buffer: Buffer.from('x'), objectPath: '' })).rejects.toThrow(/empty/i);
    await expect(service.store({ buffer: Buffer.from('x'), objectPath: '   ' })).rejects.toThrow(/empty/i);
  });

  it('never returns absolute filesystem paths in metadata', async () => {
    const meta = await service.store({ buffer: Buffer.from('x'), objectPath: 'videos/v/source' });
    expect(meta.key).not.toContain(root);
    expect(meta.key.startsWith('/') || /^[A-Za-z]:/.test(meta.key)).toBe(false);
  });
});