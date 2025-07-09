import { Module } from '@onebun/core';

import { ApiController } from './api.controller';
import { CounterController } from './counter.controller';
import { CounterService } from './counter.service';
import { ExternalApiService } from './external-api.service';

@Module({
  controllers: [CounterController, ApiController],
  providers: [CounterService, ExternalApiService],
})
export class AppModule {}
