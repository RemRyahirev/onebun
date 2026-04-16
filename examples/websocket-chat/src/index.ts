import { OneBunApplication } from '@onebun/core';

import { ChatModule } from './chat.module';
import { envSchema } from './config';

const app = new OneBunApplication(ChatModule, {
  envSchema,
  websocket: {},
});

await app.start();

const logger = app.getLogger();
logger.info(`Chat server running on ${app.getHttpUrl()}`);
logger.info(`Native WebSocket: ws://localhost:${app.getPort()}/chat`);
