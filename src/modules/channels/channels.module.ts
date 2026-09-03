import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { CreatorChannelsController } from './creator-channels.controller';
import { AdminChannelsController } from './admin-channels.controller';

@Module({
  controllers: [CreatorChannelsController, AdminChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
