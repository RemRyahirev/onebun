import { Module } from '@onebun/core';

import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  controllers: [ChatGateway],
  providers: [ChatService],
})
export class ChatModule {}
