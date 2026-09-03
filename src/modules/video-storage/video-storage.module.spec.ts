import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { VideoStorageModule } from './video-storage.module';
import { VIDEO_STORAGE_PROVIDER, VideoStorageProvider } from './video-storage.types';

describe('VideoStorageModule wiring', () => {
  it('resolves the local provider via DI', async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), VideoStorageModule.register()],
    }).compile();
    const provider = mod.get<VideoStorageProvider>(VIDEO_STORAGE_PROVIDER);
    expect(provider).toBeDefined();
    expect(provider.name).toBe('local');
  });
});
