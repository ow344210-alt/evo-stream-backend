import { DynamicModule, Module } from '@nestjs/common';
import {
  VIDEO_STORAGE_PROVIDER,
  VideoStorageProvider,
} from './video-storage.types';
import { VideoStorageConfig } from './video-storage.config';
import { LocalVideoStorageService } from './local-video-storage.service';
import { BunnyVideoStorageService } from './bunny-video-storage.service';

/**
 * Video storage foundation module.
 *
 * Resolves a single configured `VideoStorageProvider` exposed via the
 * `VIDEO_STORAGE_PROVIDER` token. Consumers depend on the abstraction, never on
 * a concrete provider class, so swapping providers is purely configuration
 * driven.
 *
 * Provider names that require an unimplemented adapter (e.g. `s3`) fail at
 * startup with a clear error (see `VideoStorageConfig`), so production can
 * never silently fall back to local development storage.
 */
@Module({})
export class VideoStorageModule {
  static register(): DynamicModule {
    return {
      module: VideoStorageModule,
      global: true,
      providers: [
        VideoStorageConfig,
        {
          provide: VIDEO_STORAGE_PROVIDER,
          inject: [VideoStorageConfig],
          useFactory: (config: VideoStorageConfig): VideoStorageProvider => {
            if (config.provider === 'local') {
              return new LocalVideoStorageService(config.localStoragePath);
            }
            if (config.provider === 'bunny') {
              return new BunnyVideoStorageService({
                storageZone: config.bunnyStorageZone!,
                apiKey: config.bunnyStorageApiKey!,
                storageHost: config.bunnyStorageHostname!,
                pullZoneHostname: config.bunnyPullZoneHostname ?? null,
              });
            }
            // Reached only if a future adapter is registered; the config class
            // already rejects unsupported providers on construction.
            throw new Error(
              `VIDEO_STORAGE_PROVIDER "${config.provider}" is not yet implemented`,
            );
          },
        },
      ],
      exports: [VIDEO_STORAGE_PROVIDER, VideoStorageConfig],
    };
  }
}