import { BaseController, Controller, Get, Post, Body, Param } from '@onebun/core';

interface IncrementRequest {
  value?: number;
}

@Controller('/api')
export class CounterController extends BaseController {
  @Get('/')
  async hello() {
    this.logger.info('Hello endpoint called');
    return this.success({ message: 'Hello OneBun!' });
  }

  @Get('/info')
  async getInfo() {
    // Demonstrate configuration access in controller
    const serverPort = this.config?.get('server.port') || 'N/A';
    const serverHost = this.config?.get('server.host') || 'N/A';
    
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
  async getCounter() {
    this.logger.info('Getting current counter value');
    
    return this.success({
      value: 42,
      timestamp: new Date().toISOString()
    });
  }

  @Post('/counter/increment')
  async incrementCounter(@Body() body: IncrementRequest) {
    const increment = body.value || 1;
    const newValue = 42 + increment;
    
    this.logger.info('Incrementing counter', { increment, newValue });
    
    return this.success({
      value: newValue,
      increment,
      timestamp: new Date().toISOString()
    });
  }

  @Get('/counter/:id')
  async getCounterById(@Param('id') id: string) {
    this.logger.info('Getting counter by ID', { id });
    
    return this.success({
      id,
      value: parseInt(id) * 10,
      timestamp: new Date().toISOString()
    });
  }
}
