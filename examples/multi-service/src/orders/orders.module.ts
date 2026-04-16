import { Module } from '@onebun/core';

import { OrderController } from './orders.controller';
import { OrderService } from './orders.service';

@Module({
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
