import { BaseController, Controller, Get, Post, Body, Param } from '@onebun/core';
import { CounterService } from './counter.service';

@Controller('/api')
export class CounterController extends BaseController {
  constructor(private counterService: CounterService, logger?: any, config?: any) {
    super(logger, config);
  }

  @Get('/')
  async hello() {
    this.logger.info('Hello endpoint called');
    return this.success({ message: 'Hello OneBun with Metrics!' });
  }

  @Get('/info')
  async getInfo() {
    // Demonstrate configuration access in controller
    const serverPort = this.config?.get('server.port') || 3001;
    const serverHost = this.config?.get('server.host') || '0.0.0.0';
    
    this.logger.info('Getting application info', { port: serverPort, host: serverHost });
    
    return this.success({
      message: 'Counter Service Info',
      server: {
        port: serverPort,
        host: serverHost
      },
      timestamp: new Date().toISOString(),
      configAvailable: this.config !== null && this.config !== undefined
    });
  }

  @Get('/counter')
  async getValue() {
    const value = this.counterService.getValue();
    this.logger.info('Getting counter value', { value });
    return this.success({ value });
  }

  @Post('/increment')
  async increment(@Body() body?: { amount?: number }) {
    const amount = body?.amount || 1;
    const newValue = this.counterService.increment(amount);
    this.logger.info('Counter incremented', { amount, newValue });
    
    return this.success({
      value: newValue,
      message: `Counter incremented by ${amount}`
    });
  }

  @Post('/decrement')  
  async decrement(@Body() body?: { amount?: number }) {
    const amount = body?.amount || 1;
    const newValue = this.counterService.decrement(amount);
    this.logger.info('Counter decremented', { amount, newValue });
    
    return this.success({
      value: newValue,
      message: `Counter decremented by ${amount}`
    });
  }

  @Post('/reset')
  async reset() {
    this.counterService.reset();
    this.logger.info('Counter reset');
    
    return this.success({
      value: 0,
      message: 'Counter reset to 0'
    });
  }

  @Get('/stats')
  async getStats() {
    const stats = {
      value: this.counterService.getValue(),
      totalOperations: this.counterService.getTotalOperations(),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
    this.logger.info('Getting stats', { totalOperations: stats.totalOperations });
    
    return this.success(stats);
  }

  @Get('/:id')
  async getById(@Param('id') id: string) {
    this.logger.info('Getting counter by id', { id });
    
    return this.success({
      id,
      value: this.counterService.getValue()
    });
  }
}
