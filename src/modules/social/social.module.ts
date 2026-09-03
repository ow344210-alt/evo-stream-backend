import { Module } from '@nestjs/common';
import { AuthModuleOptions, PassportModule } from '@nestjs/passport';
import { VideoPlaybackModule } from '../video-playback/video-playback.module';
import { VideoSocialController } from './video-social.controller';
import { ChannelSocialController } from './channel-social.controller';
import { MeSocialController } from './me-social.controller';
import { LikesService } from './likes.service';
import { CommentsService } from './comments.service';
import { FollowsService } from './follows.service';
import { SavedVideosService } from './saved-videos.service';
import { WatchHistoryService } from './watch-history.service';
import { VideoSharesService } from './video-shares.service';
import { SocialSummaryService } from './social-summary.service';

/**
 * Social module (P2-7): likes, comments/replies, channel follows, saved
 * videos, watch history, and shares, plus aggregate social summaries.
 *
 * All social mutations require JWT authentication; the viewer's user id is
 * derived from the request, never from the body. Social reads/mutations reuse
 * the playback eligibility rule (READY + PUBLISHED) via VideoPlaybackService.
 */
@Module({
  imports: [VideoPlaybackModule, PassportModule],
  controllers: [VideoSocialController, ChannelSocialController, MeSocialController],
  providers: [
    { provide: AuthModuleOptions, useValue: {} },
    LikesService,
    CommentsService,
    FollowsService,
    SavedVideosService,
    WatchHistoryService,
    VideoSharesService,
    SocialSummaryService,
  ],
  exports: [
    LikesService,
    CommentsService,
    FollowsService,
    SavedVideosService,
    WatchHistoryService,
    VideoSharesService,
    SocialSummaryService,
  ],
})
export class SocialModule {}
