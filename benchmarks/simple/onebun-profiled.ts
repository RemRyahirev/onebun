/**
 * OneBun server with framework profiling enabled.
 * Used by run-profiled.sh to measure internal overhead under load.
 *
 * Endpoints:
 *   GET /              — hello world (no params, no DI call)
 *   GET /greet/:name   — with path param + service DI call
 *   GET /_profile      — last N profiling reports as JSON
 */
/* eslint-disable no-console */
import {
  BaseController,
  BaseService,
  Controller,
  Get,
  Module,
  OneBunApplication,
  Param,
  Service,
} from '@onebun/core';


@Service()
class GreetService extends BaseService {
  greet(name: string): { message: string } {
    return { message: `Hello, ${name}!` };
  }
}

@Controller()
class BenchController extends BaseController {
  constructor(private greetService: GreetService) {
    super();
  }

  @Get()
  hello(): { message: string } {
    return { message: 'Hello, World!' };
  }

  @Get('/greet/:name')
  greet(@Param('name') name: string): { message: string } {
    return this.greetService.greet(name);
  }
}

@Module({
  controllers: [BenchController],
  providers: [GreetService],
})
class BenchModule {}

const BENCH_PORT = 3100;

const app = new OneBunApplication(BenchModule, {
  port: BENCH_PORT,
  host: '0.0.0.0',
  metrics: { enabled: false },
  tracing: { enabled: false },
  profiling: {
    enabled: true,
    endpoint: '/_profile',
    maxReports: 5000,
  },
});

await app.start();
console.log(`Profiled server on http://127.0.0.1:${BENCH_PORT}/`);
