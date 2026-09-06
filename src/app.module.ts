import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CreatorsModule } from './modules/creators/creators.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { PoliciesModule } from './modules/policies/policies.module';
import { VideosModule } from './modules/videos/videos.module';
import { VideoStorageModule } from './modules/video-storage/video-storage.module';
import { VideoProcessingModule } from './modules/video-processing/video-processing.module';
import { VideoPlaybackModule } from './modules/video-playback/video-playback.module';
import { SocialModule } from './modules/social/social.module';
import { PublicFeedModule } from './modules/public-feed/public-feed.module';
import { CreatorDashboardModule } from './modules/creator-dashboard/creator-dashboard.module';

/**
 * Resolve the backend `.env` file deterministically, independently of the
 * process working directory.
 *
 * The previous `envFilePath: '.env'` was a relative path resolved against
 * `process.cwd()`. Starting the backend from any directory other than the
 * backend root (e.g. the repository root, an IDE task, or a script) silently
 * skipped `D:\Evo-Platform-main\backend\.env`, leaving `EMAIL_FROM` (and every
 * other variable) undefined at runtime — producing
 * "EMAIL_FROM is not configured; email not sent". Walking up from this module
 * file's own location finds the backend `.env` in both source (`src/`) and
 * compiled (`dist/`) layouts, and never reads variable values from here.
 */
function resolveEnvFilePath(): string {
  let dir = __dirname;
  while (true) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return '.env';
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvFilePath(),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CreatorsModule,
    ChannelsModule,
    CategoriesModule,
    PoliciesModule,
    VideosModule,
    VideoStorageModule.register(),
    VideoProcessingModule.register(),
    VideoPlaybackModule,
    SocialModule,
    PublicFeedModule,
    CreatorDashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}