import {
  BaseController,
  Controller,
  Get,
  Module,
  OneBunApplication,
} from '@onebun/core';

@Controller()
class BenchController extends BaseController {
  @Get()
  hello(): { message: string } {
    return { message: 'Hello, World!' };
  }
}

@Module({
  controllers: [BenchController],
})
class BenchModule {}

const BENCH_PORT = 3100;

const app = new OneBunApplication(BenchModule, {
  port: BENCH_PORT,
  host: '0.0.0.0',
  metrics: { enabled: false },
  tracing: { enabled: false },
});

app.start().catch((error: unknown) => {
  throw error instanceof Error ? error : new Error(String(error));
});
