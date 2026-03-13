import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import {
  Controller,
  Get,
  Module,
  Post,
  Body,
  Param,
} from '../decorators/decorators';
import { Controller as BaseController } from '../module/controller';
import { BaseService, Service } from '../module/service';

import { TestingModule, type CompiledTestingModule } from './testing-module';

// ============================================================================
// Test fixtures
// ============================================================================

@Service()
class GreetingService extends BaseService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }
}

@Controller('/greet')
class GreetController extends BaseController {
  constructor(private readonly greetingService: GreetingService) {
    super();
  }

  @Get('/:name')
  getGreeting(@Param('name') name: string) {
    return { message: this.greetingService.greet(name) };
  }

  @Post('/echo')
  echo(@Body() body: unknown) {
    return body;
  }
}

@Module({
  controllers: [GreetController],
  providers: [GreetingService],
})
class GreetModule {}

// ============================================================================
// Tests
// ============================================================================

describe('TestingModule', () => {
  describe('compile()', () => {
    it('starts the application on a random port', async () => {
      const module = await TestingModule.create({
        imports: [],
        controllers: [GreetController],
        providers: [GreetingService],
      }).compile();

      try {
        const response = await module.inject('GET', '/greet/world');
        expect(response.status).toBe(200);
      } finally {
        await module.close();
      }
    });

    it('works with a pre-decorated module via imports', async () => {
      const module = await TestingModule.create({
        imports: [GreetModule],
      }).compile();

      try {
        const response = await module.inject('GET', '/greet/test');
        expect(response.status).toBe(200);
      } finally {
        await module.close();
      }
    });
  });

  describe('inject()', () => {
    let module: CompiledTestingModule;

    beforeEach(async () => {
      module = await TestingModule.create({
        controllers: [GreetController],
        providers: [GreetingService],
      }).compile();
    });

    afterEach(async () => {
      await module.close();
    });

    it('GET request returns JSON body from controller', async () => {
      const response = await module.inject('GET', '/greet/alice');
      const body = await response.json() as { result: { message: string } };

      expect(body.result.message).toBe('Hello, alice!');
    });

    it('POST request passes body to handler', async () => {
      const response = await module.inject('POST', '/greet/echo', { body: { ping: 'pong' } });
      const body = await response.json() as { result: { ping: string } };

      expect(body.result.ping).toBe('pong');
    });

    it('returns 404 for unknown routes', async () => {
      const response = await module.inject('GET', '/unknown/path');

      expect(response.status).toBe(404);
    });

    it('supports query parameters', async () => {
      const response = await module.inject('GET', '/greet/world', { query: { lang: 'en' } });
      // Just verifies the request doesn't crash (query is ignored by this handler)
      expect(response.status).toBe(200);
    });
  });

  describe('get()', () => {
    it('retrieves a service instance by class', async () => {
      const module = await TestingModule.create({
        controllers: [GreetController],
        providers: [GreetingService],
      }).compile();

      try {
        const service = module.get(GreetingService);
        expect(service).toBeInstanceOf(GreetingService);
        expect(service.greet('test')).toBe('Hello, test!');
      } finally {
        await module.close();
      }
    });
  });

  describe('overrideProvider()', () => {
    it('useValue() replaces service so controller uses mock', async () => {
      const mockService = {
        greet: (_name: string) => 'Mocked greeting!',
      };

      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .overrideProvider(GreetingService).useValue(mockService)
        .compile();

      try {
        const response = await module.inject('GET', '/greet/anyone');
        const body = await response.json() as { result: { message: string } };

        expect(body.result.message).toBe('Mocked greeting!');
      } finally {
        await module.close();
      }
    });

    it('useClass() replaces service with instance of provided class', async () => {
      @Service()
      class MockGreetingService extends BaseService {
        greet(_name: string): string {
          return 'Class mock!';
        }
      }

      const module = await TestingModule
        .create({
          controllers: [GreetController],
          providers: [GreetingService],
        })
        .overrideProvider(GreetingService).useClass(MockGreetingService)
        .compile();

      try {
        const response = await module.inject('GET', '/greet/anyone');
        const body = await response.json() as { result: { message: string } };

        expect(body.result.message).toBe('Class mock!');
      } finally {
        await module.close();
      }
    });
  });
});
