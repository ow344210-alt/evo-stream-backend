import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { LikesService } from './likes.service';
import { SavedVideosService } from './saved-videos.service';
import { WatchHistoryService } from './watch-history.service';
import { FollowsService } from './follows.service';

/**
 * Viewer-scoped collection endpoints (liked videos, saved videos, watch
 * history, followed channels). All routes require authentication.
 */
@Controller('me')
export class MeSocialController {
  constructor(
    private readonly likes: LikesService,
    private readonly saved: SavedVideosService,
    private readonly historyService: WatchHistoryService,
    private readonly follows: FollowsService,
  ) {}

  @Get('likes')
  likedVideos(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.likes.getLikedVideos(userId, query);
  }

  @Get('saved')
  savedVideos(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.saved.getSavedVideos(userId, query);
  }

  @Get('history')
  history(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.historyService.getHistory(userId, query);
  }

  @Delete('history/:videoId')
  removeHistory(
    @CurrentUser('id') userId: string,
    @Param('videoId', ParseUUIDPipe) videoId: string,
  ) {
    return this.historyService.removeHistoryItem(userId, videoId);
  }

  @Get('following')
  following(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.follows.getFollowing(userId, query);
  }
}
