import { Readable } from 'stream';

/**
 * Supported video storage providers.
 *
 * - `local`: filesystem-backed storage for development/tests.
 * - `s3` / `bunny`: production-capable adapters. Their real implementations are
 *   deferred to the provider-specific step; selecting one explicitly now causes
 *   a clear configuration error instead of silently routing to a fallback.
 */
export type VideoStorageProviderName = 'local' | 's3' | 'bunny';

/** Everything needed to persist a video source object. */
export interface VideoStorageStoreInput {
  /** Source bytes to persist. */
  buffer: Buffer;
  /**
   * Logical, provider-relative location such as `videos/{videoId}/source/main`.
   * The provider is responsible for normalising this into a provider-safe key
   * and for rejecting dangerous/escaping paths. A file extension may be present
   * but is not required; the provider keeps object identity stable and
   * provider-safe.
   */
  objectPath: string;
  /** Original client filename, stored for reference/metadata only. */
  originalName?: string;
  /** Media type of the object, when known. */
  mimeType?: string;
}

/**
 * Metadata describing a successfully stored object. This is the persistent,
 * provider-stable identity for an object; it must NOT rely on a public URL,
 * so CDN/domain configuration can change later without breaking references.
 */
export interface VideoStorageObject {
  /** The configured provider name (e.g. `local`). */
  provider: string;
  /** Stable, provider-safe object identifier / key. */
  key: string;
  /** Original client filename, when provided at store time. */
  originalName?: string;
  /** Media type, when known. */
  mimeType?: string;
  /** Size in bytes of the stored object. */
  sizeBytes?: number;
}

/**
 * Internal contract used by the Video domain and future upload/processing
 * steps. The rest of the application must depend on this abstraction and never
 * on a concrete provider class.
 */
export interface VideoStorageProvider {
  readonly name: VideoStorageProviderName;

  /**
   * Persist `input.buffer` under a safe, provider-normalised key derived from
   * `input.objectPath`. Returns the stored object metadata. Throws on unsafe
   * paths or I/O failure; never returns raw server filesystem paths.
   */
  store(input: VideoStorageStoreInput): Promise<VideoStorageObject>;

  /**
   * Remove the object identified by `key`. Deleting an already-missing object
   * is a defined no-op and resolves successfully. Throws only on unexpected
   * I/O errors.
   */
  delete(key: string): Promise<void>;

  /**
   * Retrieve metadata for a stored object, or `null` when it does not exist.
   */
  getObject(key: string): Promise<VideoStorageObject | null>;
}

/** DI token for the configured `VideoStorageProvider` implementation. */
export const VIDEO_STORAGE_PROVIDER = Symbol('VIDEO_STORAGE_PROVIDER');

/** Convenience type for streamable uploads in a later step. */
export type VideoSourceReadable = Buffer | Readable;