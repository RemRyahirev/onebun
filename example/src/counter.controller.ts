import {
  BaseController,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@onebun/core';

import { CounterService } from './counter.service';

@Controller('/api')
export class CounterController extends BaseController {
  constructor(private counterService: CounterService) {
    super();
  }

  @Get('/')
  async hello(): Promise<Response> {
    this.logger.info('Hello endpoint called');

    return this.success({ message: 'Hello OneBun with Metrics!' });
  }

  @Get('/info')
  async getInfo(): Promise<Response> {
    // Demonstrate configuration access in controller
    const DEFAULT_PORT = 3001;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serverPort = (this.config as any)?.get('server.port') || DEFAULT_PORT;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serverHost = (this.config as any)?.get('server.host') || '0.0.0.0';

    this.logger.info('Getting application info', { port: serverPort, host: serverHost });

    return this.success({
      message: 'Counter Service Info',
      server: {
        port: serverPort,
        host: serverHost,
      },
      timestamp: new Date().toISOString(),
      configAvailable: this.config !== null && this.config !== undefined,
    });
  }

  @Get('/counter')
  async getValue(): Promise<Response> {
    const value = this.counterService.getValue();
    this.logger.info('Getting counter value', { value });

    return this.success({ value });
  }

  @Post('/increment')
  async increment(@Body() body?: { amount?: number }): Promise<Response> {
    const amount = body?.amount || 1;
    const newValue = this.counterService.increment(amount);
    this.logger.info('Counter incremented', { amount, newValue });

    return this.success({
      value: newValue,
      message: `Counter incremented by ${amount}`,
    });
  }

  @Post('/decrement')
  async decrement(@Body() body?: { amount?: number }): Promise<Response> {
    const amount = body?.amount || 1;
    const newValue = this.counterService.decrement(amount);
    this.logger.info('Counter decremented', { amount, newValue });

    return this.success({
      value: newValue,
      message: `Counter decremented by ${amount}`,
    });
  }

  @Post('/reset')
  async reset(): Promise<Response> {
    this.counterService.reset();
    this.logger.info('Counter reset');

    return this.success({
      value: 0,
      message: 'Counter reset to 0',
    });
  }

  @Get('/stats')
  async getStats(): Promise<Response> {
    const stats = {
      value: this.counterService.getValue(),
      totalOperations: this.counterService.getTotalOperations(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };
    this.logger.info('Getting stats', { totalOperations: stats.totalOperations });

    return this.success(stats);
  }

  @Get('/counter/:id')
  async getById(@Param('id') id: string): Promise<Response> {
    this.logger.info('Getting counter by id', { id });

    return this.success({
      id,
      value: this.counterService.getValue(),
    });
  }
}
