import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { LikesService } from './likes.service';
import { CommentsService } from './comments.service';
import { SavedVideosService } from './saved-videos.service';
import { WatchHistoryService } from './watch-history.service';
import { VideoSharesService } from './video-shares.service';
import { SocialSummaryService } from './social-summary.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments.query';
import { RecordProgressDto } from './dto/record-progress.dto';

@Controller()
export class VideoSocialController {
  constructor(
    private readonly likes: LikesService,
    private readonly comments: CommentsService,
    private readonly saved: SavedVideosService,
    private readonly history: WatchHistoryService,
    private readonly shares: VideoSharesService,
    private readonly summaryService: SocialSummaryService,
  ) {}

  // ---- Likes ----

  @Post('videos/:videoId/like')
  like(@CurrentUser('id') userId: string, @Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.likes.like(userId, videoId);
  }

  @Delete('videos/:videoId/like')
  unlike(@CurrentUser('id') userId: string, @Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.likes.unlike(userId, videoId);
  }

  // ---- Comments ----

  @Post('videos/:videoId/comments')
  createComment(
    @CurrentUser('id') userId: string,
    @Param('videoId', ParseUUIDPipe) videoId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(userId, videoId, dto);
  }

  @Public()
  @Get('videos/:videoId/comments')
  listComments(
    @Param('videoId', ParseUUIDPipe) videoId: string,
    @Query() query: ListCommentsQueryDto,
  ) {
    return this.comments.list(videoId, query);
  }

  @Patch('comments/:commentId')
  updateComment(
    @CurrentUser('id') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(userId, commentId, dto);
  }

  @Delete('comments/:commentId')
  removeComment(
    @CurrentUser('id') userId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.comments.remove(userId, commentId);
  }

  // ---- Saved ----

  @Post('videos/:videoId/save')
  save(@CurrentUser('id') userId: string, @Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.saved.save(userId, videoId);
  }

  @Delete('videos/:videoId/save')
  unsave(@CurrentUser('id') userId: string, @Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.saved.unsave(userId, videoId);
  }

  // ---- Watch history ----

  @Post('videos/:videoId/progress')
  recordProgress(
    @CurrentUser('id') userId: string,
    @Param('videoId', ParseUUIDPipe) videoId: string,
    @Body() dto: RecordProgressDto,
  ) {
    return this.history.recordProgress(userId, videoId, dto);
  }

  // ---- Shares ----

  @Post('videos/:videoId/share')
  share(@CurrentUser('id') userId: string, @Param('videoId', ParseUUIDPipe) videoId: string) {
    return this.shares.share(userId, videoId);
  }

  // ---- Summary ----

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('videos/:videoId/social-summary')
  summary(
    @Param('videoId', ParseUUIDPipe) videoId: string,
    @CurrentUser('id') userId?: string,
  ) {
    return this.summaryService.getSummary(videoId, userId);
  }
}
