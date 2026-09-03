import { Module } from '@nestjs/common';
import { VideosService } from './videos.service';
import { CreatorVideosController } from './creator-videos.controller';
import { AdminVideosController } from './admin-videos.controller';
import {
  VideoStorageConfig,
  VideoUploadPolicy,
  videoUploadPolicyFromConfig,
} from '../video-storage/video-storage.config';

@Module({
  controllers: [CreatorVideosController, AdminVideosController],
  providers: [
    VideosService,
    {
      provide: VideoUploadPolicy,
      inject: [VideoStorageConfig],
      useFactory: (config: VideoStorageConfig): VideoUploadPolicy =>
        videoUploadPolicyFromConfig(config),
    },
  ],
  exports: [VideosService],
})
export class VideosModule {}