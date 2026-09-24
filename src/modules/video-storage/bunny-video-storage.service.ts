import { Injectable, Logger } from '@nestjs/common';
import {
  VideoStorageObject,
  VideoStorageProvider,
  VideoStorageStoreInput,
} from './video-storage.types';
import { buildSafeObjectKey } from './storage-path.util';

/**
 * Configuration required by the Bunny storage provider. Values come from
 * `VideoStorageConfig` (environment-driven). The API key is held in memory and
 * is NEVER logged or included in error messages.
 */
export interface BunnyStorageConfig {
  /** Bunny storage zone name. */
  storageZone: string;
  /** Bunny storage zone API key (secret). */
  apiKey: string;
  /** Bunny storage API hostname, e.g. `storage.bunnycdn.com`. */
  storageHost: string;
  /** Bunny pull zone (CDN) hostname, e.g. `my-zone.b-cdn.net`. */
  pullZoneHostname: string | null;
}

/**
 * Upper bound for every Bunny Storage HTTP request. Generous enough for multi-
 * hundred-MB transfers while guaranteeing a stalled connection can never hang
 * the processing pipeline (or the upload request) forever. A `fetch` in Node
 * has no built-in timeout, so every request is aborted beyond this window and
 * surfaced as a sanitized error by the storage layer.
 */
const BUNNY_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function parseContentRange(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /bytes \d+-\d+\/(\d+)/.exec(value);
  return match ? Number(match[1]) : undefined;
}

/**
 * Bunny.net storage provider for production video storage.
 *
 * Uses the Bunny Storage API over plain Node `fetch` (no SDK). Security
 * invariants:
 * - Object keys are normalised via `buildSafeObjectKey` (traversal segments
 *   rejected) before they ever reach a URL.
* - The API key is sent only in the `AccessKey` header and never appears
   *   in logs or error messages.
 * - `delete` / `deletePrefix` treat an already-missing object/prefix (HTTP
 *   404) as a defined no-op.
 * - The public URL is derived from the CDN pull zone hostname; storage keys
 *   remain the provider-stable identity.
 *
 * The full HLS tree (master playlist, per-rendition playlists, TS segments,
 * poster) is uploaded file-by-file preserving the relative layout, so the
 * relative references inside playlists resolve over the CDN unchanged.
 */
@Injectable()
export class BunnyVideoStorageService implements VideoStorageProvider {
  readonly name = 'bunny' as const;

  private readonly logger = new Logger(BunnyVideoStorageService.name);

  constructor(private readonly config: BunnyStorageConfig) {}

  private objectUrl(key: string): string {
    return `https://${this.config.storageHost}/${this.config.storageZone}/${key}`;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      AccessKey: this.config.apiKey,
      ...extra,
    };
  }

  /**
   * Bounded HTTP request: aborts the underlying `fetch` after
   * `BUNNY_REQUEST_TIMEOUT_MS` and converts the abort into a sanitized,
   * credential-free error. Non-timeout failures propagate unchanged.
   */
  private request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUNNY_REQUEST_TIMEOUT_MS);
    return fetch(url, { ...init, signal: controller.signal })
      .finally(() => clearTimeout(timer))
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          throw new Error(
            `Bunny storage request timed out after ${BUNNY_REQUEST_TIMEOUT_MS}ms`,
          );
        }
        throw error;
      });
  }

  private mimeForKey(key: string): string | undefined {
    const dotIndex = key.lastIndexOf('.');
    if (dotIndex < 0) return undefined;
    return EXTENSION_MIME_TYPES[key.slice(dotIndex).toLowerCase()];
  }

  async store(input: VideoStorageStoreInput): Promise<VideoStorageObject> {
    const key = buildSafeObjectKey(input.objectPath);
    const mimeType = input.mimeType ?? this.mimeForKey(key);

    const response = await this.request(this.objectUrl(key), {
      method: 'PUT',
      headers: this.authHeaders(mimeType ? { 'Content-Type': mimeType } : undefined),
      body: input.buffer as unknown as BodyInit,
    });

    if (!response.ok) {
      throw new Error(`Bunny storage upload failed with HTTP ${response.status}`);
    }
    await response.body?.cancel();

    return {
      provider: 'bunny',
      key,
      originalName: input.originalName,
      mimeType,
      sizeBytes: input.buffer.length,
    };
  }

  async delete(key: string): Promise<void> {
    const safeKey = buildSafeObjectKey(key);
    const response = await this.request(this.objectUrl(safeKey), {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    // Deleting an already-missing object is a defined no-op.
    if (response.status === 404) return;
    if (!response.ok) {
      throw new Error(`Bunny storage delete failed with HTTP ${response.status}`);
    }
    await response.body?.cancel();
  }

  async deletePrefix(prefix: string): Promise<void> {
    const safePrefix = buildSafeObjectKey(prefix);
    const response = await this.request(this.objectUrl(safePrefix), {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    // Deleting a prefix that does not exist yet is a defined no-op.
    if (response.status === 404) return;
    if (!response.ok) {
      throw new Error(`Bunny storage delete (prefix) failed with HTTP ${response.status}`);
    }
    await response.body?.cancel();
  }

  async getObject(key: string): Promise<VideoStorageObject | null> {
    const safeKey = buildSafeObjectKey(key);
    const response = await this.request(this.objectUrl(safeKey), {
      method: 'GET',
      headers: this.authHeaders({ Range: 'bytes=0-0' }),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Bunny storage metadata request failed with HTTP ${response.status}`);
    }
    const sizeBytes =
      parseContentRange(response.headers.get('content-range')) ??
      (Number(response.headers.get('content-length')) || undefined);
    await response.body?.cancel();
    return { provider: 'bunny', key: safeKey, sizeBytes };
  }

  async read(key: string): Promise<Buffer> {
    const safeKey = buildSafeObjectKey(key);
    const response = await this.request(this.objectUrl(safeKey), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Bunny storage read failed with HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  getPublicUrl(key: string): string | null {
    if (!this.config.pullZoneHostname) return null;
    const safeKey = buildSafeObjectKey(key);
    return `https://${this.config.pullZoneHostname}/${safeKey}`;
  }
}