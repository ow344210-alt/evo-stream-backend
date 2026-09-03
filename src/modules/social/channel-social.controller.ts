import {
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FollowsService } from './follows.service';

@Controller('channels')
export class ChannelSocialController {
  constructor(private readonly follows: FollowsService) {}

  @Post(':channelId/follow')
  follow(
    @CurrentUser('id') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ) {
    return this.follows.follow(userId, channelId);
  }

  @Delete(':channelId/follow')
  unfollow(
    @CurrentUser('id') userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ) {
    return this.follows.unfollow(userId, channelId);
  }
}
