import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Controller('creator/channel')
@Roles(UserRole.CREATOR)
export class CreatorChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  async getMy(@CurrentUser('id') userId: string) {
    const profile = await this.channels.getCreatorProfile(userId);
    return { channel: profile.channel };
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateChannelDto) {
    return this.channels.createMyChannel(userId, dto);
  }

  @Patch()
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateChannelDto) {
    return this.channels.updateMyChannel(userId, dto);
  }
}
