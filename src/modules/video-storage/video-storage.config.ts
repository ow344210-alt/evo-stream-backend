import path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoStorageProviderName } from './video-storage.types';

const DEFAULT_LOCAL_STORAGE_PATH = 'storage';
const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const DEFAULT_ACCEPTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];

function isKnownProvider(value: string | undefined): value is VideoStorageProviderName {
  return value === 'local' || value === 's3' || value === 'bunny';
}

/**
 * Validated, environment-driven configuration for the video storage
 * foundation. Constructed eagerly on startup so that invalid production or
 * provider configuration fails fast with a clear message instead of surfacing
 * unpredictably during an upload call.
 *
 * Only variables genuinely required by this implementation are read here.
 * Future provider credentials are intentionally NOT read or stored by this
 * class, so they cannot leak through the application.
 */
@Injectable()
export class VideoStorageConfig {
  private readonly logger = new Logger(VideoStorageConfig.name);

  /** Selected storage provider. */
  readonly provider: VideoStorageProviderName;

  /** Absolute, validated local storage root (used by the `local` provider). */
  readonly localStoragePath: string;

  /** Maximum accepted size (bytes) of a single uploaded video source. */
  readonly maxUploadBytes: number;

  /** Accepted video media types for future upload validation. */
  readonly acceptedVideoMimeTypes: readonly string[];

  constructor(private readonly config: ConfigService) {
    const rawProvider = this.config.get<string>('VIDEO_STORAGE_PROVIDER') ?? 'local';
    if (!isKnownProvider(rawProvider)) {
      throw new Error(
        `Unsupported VIDEO_STORAGE_PROVIDER "${rawProvider}". ` +
          `Supported values: local, s3, bunny.`,
      );
    }
    this.provider = rawProvider;

    if (rawProvider === 'local') {
      this.localStoragePath = this.resolveLocalStoragePath(
        this.config.get<string>('VIDEO_LOCAL_STORAGE_PATH'),
      );
    } else {
      // Production adapters are deferred (P2-3+). Selecting one now must fail
      // clearly at startup rather than silently falling back to local storage.
      this.localStoragePath = '';
      throw new Error(
        `VIDEO_STORAGE_PROVIDER "${rawProvider}" is not yet implemented. ` +
          `The production adapter is deferred to the provider-specific step. ` +
          `Until then, use VIDEO_STORAGE_PROVIDER=local for development/tests.`,
      );
    }

    this.maxUploadBytes = this.parseMaxUploadBytes(this.config.get<string>('VIDEO_MAX_UPLOAD_BYTES'));
    this.acceptedVideoMimeTypes = this.parseAcceptedMimeTypes(
      this.config.get<string>('VIDEO_ACCEPTED_MIME_TYPES'),
    );

    this.logger.log(
      `Video storage initialised: provider=${this.provider}, root=${this.localStoragePath}, ` +
        `maxUploadBytes=${this.maxUploadBytes}`,
    );
  }

  private resolveLocalStoragePath(raw: string | undefined): string {
    if (raw === undefined || raw.trim() === '') {
      // Safe default: a project-local runtime directory, never inside src/.
      return path.resolve(process.cwd(), DEFAULT_LOCAL_STORAGE_PATH);
    }
    const trimmed = raw.trim();
    if (trimmed.includes('\0')) {
      throw new Error('VIDEO_LOCAL_STORAGE_PATH must not contain null characters');
    }
    return path.resolve(process.cwd(), trimmed);
  }

  private parseMaxUploadBytes(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_MAX_UPLOAD_BYTES;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid VIDEO_MAX_UPLOAD_BYTES "${raw}". Expected a positive integer byte count.`,
      );
    }
    return Math.floor(parsed);
  }

  private parseAcceptedMimeTypes(raw: string | undefined): readonly string[] {
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_ACCEPTED_VIDEO_MIME_TYPES;
    }
    return raw
      .split(',')
      .map((m) => m.trim().toLowerCase())
      .filter((m) => m.length > 0 && m.includes('/'));
  }
}

/**
 * Upload validation foundation. Encapsulates the configurable limits that the
 * P2-3 upload endpoint will enforce. Validation logic stays provider-agnostic:
 * it only decides whether a candidate (size + MIME) is admissible. Actual
 * media inspection / transcoding is intentionally out of scope here.
 */
export class VideoUploadPolicy {
  constructor(
    readonly maxBytes: number,
    readonly acceptedMimeTypes: readonly string[],
  ) {}

  isAcceptedSize(sizeBytes: number): boolean {
    return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= this.maxBytes;
  }

  isAcceptedMimeType(mimeType: string | undefined): boolean {
    if (!mimeType) return false;
    const normalized = mimeType.toLowerCase();
    return this.acceptedMimeTypes.includes(normalized);
  }

  validate(sizeBytes: number, mimeType: string | undefined): void {
    if (!this.isAcceptedSize(sizeBytes)) {
      throw new Error(
        `Upload exceeds configured limit of ${this.maxBytes} bytes (received ${sizeBytes}).`,
      );
    }
    if (!this.isAcceptedMimeType(mimeType)) {
      throw new Error(
        `Media type ${mimeType ?? '(unknown)'} is not accepted. ` +
          `Allowed: ${this.acceptedMimeTypes.join(', ')}`,
      );
    }
  }
}

export function videoUploadPolicyFromConfig(config: VideoStorageConfig): VideoUploadPolicy {
  return new VideoUploadPolicy(config.maxUploadBytes, config.acceptedVideoMimeTypes);
}