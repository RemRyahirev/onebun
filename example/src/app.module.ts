import { Module } from '@onebun/core';
import { CounterController } from './counter.controller';
import { CounterService } from './counter.service';

@Module({
  controllers: [CounterController],
  providers: [CounterService]
})
export class AppModule {}
