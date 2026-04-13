import {
  BaseController,
  Controller,
  Get,
  Module,
  OneBunApplication,
} from '@onebun/core';

const t0 = Bun.nanoseconds();
function ms(): string {
  return `${Math.round((Bun.nanoseconds() - t0) / 1_000_000)}ms`;
}

// eslint-disable-next-line no-console
console.log(`[${ms()}] imports done`);

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

// eslint-disable-next-line no-console
console.log(`[${ms()}] decorators applied`);

const app = new OneBunApplication(BenchModule, {
  port: 3100,
  host: '0.0.0.0',
  metrics: { enabled: false },
});

// eslint-disable-next-line no-console
console.log(`[${ms()}] constructor done`);

app.start().then(() => {
  // eslint-disable-next-line no-console
  console.log(`[${ms()}] server started`);
}).catch((error: unknown) => {
  throw error instanceof Error ? error : new Error(String(error));
});
