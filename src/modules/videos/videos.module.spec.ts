import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { VideoStorageModule } from '../video-storage/video-storage.module';
import { VIDEO_STORAGE_PROVIDER, VideoStorageProvider } from '../video-storage/video-storage.types';
import { VideoUploadPolicy } from '../video-storage/video-storage.config';
import { VideoProcessingModule } from '../video-processing/video-processing.module';
import { VideoProcessingQueue } from '../video-processing/video-processing.queue';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

describe('VideosModule DI wiring', () => {
  it('injects the storage provider, upload policy and processing queue into VideosService', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        VideoStorageModule.register(),
        VideoProcessingModule.register(),
        VideosModule,
      ],
    }).compile();

    const provider = mod.get<VideoStorageProvider>(VIDEO_STORAGE_PROVIDER);
    const policy = mod.get<VideoUploadPolicy>(VideoUploadPolicy);
    const queue = mod.get<VideoProcessingQueue>(VideoProcessingQueue);
    const service = mod.get<VideosService>(VideosService);

    expect(provider).toBeDefined();
    expect(provider.name).toBe('local');
    expect(policy).toBeInstanceOf(VideoUploadPolicy);
    expect(policy.maxBytes).toBeGreaterThan(0);
    expect(queue).toBeDefined();
    expect(service).toBeDefined();
  });
});