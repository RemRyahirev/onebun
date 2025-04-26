import { ControllerDecorator, Get, Post, BaseController, UseMiddleware, Param, Query } from '@onebun/core';
import { CounterService } from './counter.service';

// Simple logger middleware
function loggerMiddleware(req: Request, next: () => Promise<Response>): Promise<Response> {
  console.log(`Request: ${req.method} ${new URL(req.url).pathname}`);
  return next();
}

// Simple timing middleware
function timingMiddleware(req: Request, next: () => Promise<Response>): Promise<Response> {
  const start = Date.now();
  return next().then(response => {
    const duration = Date.now() - start;
    console.log(`Request took ${duration}ms`);
    return response;
  });
}

@ControllerDecorator('/api')
export class CounterController extends BaseController {
  @Get('/hello')
  @UseMiddleware(loggerMiddleware)
  hello() {
    return this.success({ message: 'Hello OneBun!' });
  }

  @Get('/counter')
  @UseMiddleware(timingMiddleware)
  getCounter() {
    // Get the counter service using dependency injection
    const counterService = this.getService(CounterService);

    // Get the count directly from the service
    const count = counterService.getCount();

    // Return the count as a standardized success response
    return this.success({ count });
  }

  @Post('/counter/increment')
  @UseMiddleware(timingMiddleware)
  incrementCounter() {
    // Get the counter service using dependency injection
    const counterService = this.getService(CounterService);

    // Increment the counter and get the new count
    const count = counterService.increment();

    // Return the count as a standardized success response
    return this.success({ count });
  }

  @Get('/counter/:amount')
  @UseMiddleware(timingMiddleware)
  getCounterWithAmount(
    @Param('amount', {
      required: true,
      validator: (value: unknown): boolean => !isNaN(Number(value))
    }) amount: string,
    @Query('multiply', {
      validator: (value: unknown): boolean => !isNaN(Number(value))
    }) multiply?: string
  ) {
    // Parse parameters
    const amountValue = Number(amount);
    const multiplyValue = multiply ? Number(multiply) : 1;

    // Get the counter service using dependency injection
    const counterService = this.getService(CounterService);

    // Get the base count from the service
    const baseCount = counterService.getCount();

    // Calculate the result
    const result = {
      baseCount,
      amount: amountValue,
      multiply: multiplyValue,
      result: baseCount + amountValue * multiplyValue
    };

    // Return the result as a standardized success response
    return this.success(result);
  }
}
