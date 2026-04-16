import {
  Controller,
  BaseController,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  HttpException,
  type,
} from '@onebun/core';

import { OrderService } from './orders.service';

const createOrderSchema = type({
  userId: 'string',
  items: type({
    productId: 'string',
    quantity: 'number > 0',
    price: 'number > 0',
  }).array().configure({ minLength: 1 }),
});

const updateStatusSchema = type({
  status: '"pending" | "completed" | "cancelled"',
});

type CreateOrderBody = typeof createOrderSchema.infer;
type UpdateStatusBody = typeof updateStatusSchema.infer;

@Controller('/orders')
export class OrderController extends BaseController {
  constructor(private orderService: OrderService) {
    super();
  }

  @Get('/')
  async findAll(@Query('userId') userId?: string) {
    if (userId) {
      const orders = await this.orderService.findByUserId(userId);

      return orders;
    }
    const orders = await this.orderService.findAll();

    return orders;
  }

  @Post('/')
  async create(
    @Body(createOrderSchema) body: CreateOrderBody,
  ) {
    try {
      const order = await this.orderService.create(body);

      return this.success(order, 201);
    } catch (error) {
      if (error instanceof Error && error.message === 'User not found') {
        throw new HttpException(404, 'User not found');
      }
      throw error;
    }
  }

  @Put('/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body(updateStatusSchema) body: UpdateStatusBody,
  ) {
    const order = await this.orderService.updateStatus(id, body.status);
    if (!order) {
      throw new HttpException(404, 'Order not found');
    }

    return order;
  }
}
