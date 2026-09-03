import { DynamicModule, Module } from '@nestjs/common';
import {
  VIDEO_TRANSCODING_PROVIDER,
  VideoTranscodingProvider,
} from './video-transcoding.types';
import { VideoTranscodeConfig } from './video-transcode.config';
import { LocalVideoTranscodingService } from './local-video-transcoding.service';
import { VideoProcessingService } from './video-processing.service';
import { VideoProcessingQueue } from './video-processing.queue';

/**
 * Video processing module (P2-4).
 *
 * Exposes a single configured `VideoTranscodingProvider` via the
 * `VIDEO_TRANSCODING_PROVIDER` token, plus the processing service and queue.
 * Consumers depend on the abstraction. Local FFmpeg is the default adapter;
 * cloud/GPU encoders can be registered later without touching the processing
 * service.
 */
@Module({})
export class VideoProcessingModule {
  static register(): DynamicModule {
    return {
      module: VideoProcessingModule,
      global: true,
      providers: [
        VideoTranscodeConfig,
        LocalVideoTranscodingService,
        VideoProcessingService,
        VideoProcessingQueue,
        {
          provide: VIDEO_TRANSCODING_PROVIDER,
          useFactory: (
            transcoder: LocalVideoTranscodingService,
          ): VideoTranscodingProvider => transcoder,
          inject: [LocalVideoTranscodingService],
        },
      ],
      exports: [VIDEO_TRANSCODING_PROVIDER, VideoTranscodeConfig, VideoProcessingService, VideoProcessingQueue],
    };
  }
}