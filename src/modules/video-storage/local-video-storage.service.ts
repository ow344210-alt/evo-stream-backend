import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import {
  VideoStorageObject,
  VideoStorageProvider,
  VideoStorageStoreInput,
} from './video-storage.types';
import { buildSafeObjectKey, resolveWithin } from './storage-path.util';

/**
 * Local filesystem storage provider for development and tests.
 *
 * Security invariants:
 * - Stores under a validated absolute root (`VIDEO_LOCAL_STORAGE_PATH`, or a
 *   project-local `storage/` default). Never inside `src/`.
 * - Object keys are normalised and traversal segments rejected; the resolved
 *   path is always verified to stay inside the root.
 * - Client filenames are never used as filesystem paths; if present they are
 *   stored only as metadata.
 * - `delete` never resolves to a path outside the root.
 */
@Injectable()
export class LocalVideoStorageService implements VideoStorageProvider {
  readonly name = 'local' as const;
  readonly root: string;

  private readonly logger = new Logger(LocalVideoStorageService.name);

  constructor(rootDir?: string) {
    this.root = path.resolve(rootDir ?? 'storage');
    this.ensureRoot();
  }

  /**
   * Create the storage directory (and any parents) safely. Safe to call
   * multiple times.
   */
  ensureRoot(): void {
    fs.mkdirSync(this.root, { recursive: true });
  }

  private assertInsideRoot(absolutePath: string): void {
    // resolveWithin already guards, but re-assert before any I/O for defence in depth.
    const resolved = resolveWithin(this.root, path.relative(this.root, absolutePath));
    if (resolved !== absolutePath) {
      throw new Error('Storage path resolves outside the configured storage root');
    }
  }

  async store(input: VideoStorageStoreInput): Promise<VideoStorageObject> {
    const safeKey = buildSafeObjectKey(input.objectPath);
    const absolutePath = resolveWithin(this.root, safeKey);
    this.assertInsideRoot(absolutePath);

    await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
    await fsp.writeFile(absolutePath, input.buffer);

    return {
      provider: this.name,
      key: safeKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
    };
  }

  async delete(key: string): Promise<void> {
    const safeKey = buildSafeObjectKey(key);
    const absolutePath = resolveWithin(this.root, safeKey);
    this.assertInsideRoot(absolutePath);

    let stat: fs.Stats;
    try {
      stat = await fsp.lstat(absolutePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Missing object deletion is a defined no-op.
      if (code === 'ENOENT') return;
      throw error;
    }

    if (stat.isDirectory()) {
      await fsp.rm(absolutePath, { recursive: true, force: true });
    } else {
      await fsp.unlink(absolutePath);
    }
  }

  async getObject(key: string): Promise<VideoStorageObject | null> {
    const safeKey = buildSafeObjectKey(key);
    const absolutePath = resolveWithin(this.root, safeKey);
    this.assertInsideRoot(absolutePath);

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(absolutePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw error;
    }

    if (!stat.isFile()) return null;
    return {
      provider: this.name,
      key: safeKey,
      sizeBytes: stat.size,
    };
  }
}