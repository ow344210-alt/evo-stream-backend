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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
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