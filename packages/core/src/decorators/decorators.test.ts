/* eslint-disable
   @typescript-eslint/no-empty-function,
   @typescript-eslint/no-explicit-any,
   @typescript-eslint/naming-convention,
   @typescript-eslint/no-unused-vars,
   @typescript-eslint/no-useless-constructor */
import { type } from 'arktype';
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';

import { OneBunApplication } from '../application';
import {
  BaseController,
  BaseService,
  Service,
} from '../module';
import { makeMockLoggerLayer } from '../testing';
import { HttpMethod, ParamType } from '../types';

import {
  injectable,
  Controller,
  registerControllerDependencies,
  getConstructorParamTypes,
  Inject,
  registerDependencies,
  getControllerMetadata,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Options,
  Head,
  All,
  Param,
  Query,
  Body,
  Header,
  Req,
  Res,
  UseMiddleware,
  Module,
  getModuleMetadata,
  ApiResponse,
  UploadedFile,
  UploadedFiles,
  FormField,
} from './decorators';

describe('decorators', () => {
  beforeEach(() => {
    // Clear metadata between tests to avoid interference
    // Reset global state by creating new instances
  });

  describe('injectable', () => {
    test('should return the same class when applied', () => {
      @Service()
      class TestService {
        getName() {
          return 'test';
        }
      }

      expect(TestService).toBeDefined();
      const instance = new TestService();
      expect(instance.getName()).toBe('test');
    });

    test('should work without any modifications to class functionality', () => {
      @Service()
      class ServiceWithConstructor {
        constructor(private value: string) {}

        getValue() {
          return this.value;
        }
      }

      const instance = new ServiceWithConstructor('hello');
      expect(instance.getValue()).toBe('hello');
    });
  });

  describe('controllerDecorator and Controller', () => {
    test('should create controller metadata with default path', () => {
      @Controller()
      class TestController {}

      const metadata = getControllerMetadata(TestController);
      expect(metadata).toBeDefined();
      expect(metadata?.path).toBe('/');
      expect(metadata?.routes).toEqual([]);
    });

    test('should create controller metadata with custom path', () => {
      @Controller('api/test')
      class TestController {}

      const metadata = getControllerMetadata(TestController);
      expect(metadata).toBeDefined();
      expect(metadata?.path).toBe('/api/test');
    });

    test('should ensure path starts with slash', () => {
      @Controller('users')
      class TestController {}

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.path).toBe('/users');
    });

    test('should preserve existing routes when controller decorator is applied', () => {
      @Controller('test')
      class TestController {
        @Get('hello')
        getHello() {
          return 'hello';
        }
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes).toHaveLength(1);
      expect(metadata?.routes[0].path).toBe('/hello');
      expect(metadata?.routes[0].method).toBe(HttpMethod.GET);
    });

    test('should make controller injectable automatically', () => {
      @Controller()
      class TestController {
        constructor(private value: string = 'test') {}

        getValue() {
          return this.value;
        }
      }

      const instance = new TestController();
      expect(instance.getValue()).toBe('test');
    });

    test('should preserve class name and prototype', () => {
      @Controller()
      class OriginalController {}

      expect(OriginalController.name).toBe('OriginalController');
    });
  });

  describe('dependency injection system', () => {
    class MockService {
      getName() {
        return 'MockService';
      }
    }

    class CounterService {
      getCount() {
        return 42;
      }
    }

    test('should register dependencies automatically with decorator', () => {
      const availableServices = new Map<string, any>([
        ['MockService', MockService],
        ['CounterService', CounterService],
      ]);

      @injectable()
      class TestController {
        constructor(
          private mockService: MockService,
          private counterService: CounterService,
        ) {}
      }

      registerControllerDependencies(TestController, availableServices);
      const deps = getConstructorParamTypes(TestController);
      expect(deps).toBeDefined();
      expect(deps?.length).toBe(2);
      expect(deps).toContain(MockService);
      expect(deps).toContain(CounterService);
    });

    test('should handle constructor without parameters', () => {
      const availableServices = new Map();

      @injectable()
      class TestController {
        constructor() {}
      }

      registerControllerDependencies(TestController, availableServices);
      const deps = getConstructorParamTypes(TestController);
      expect(deps).toBeUndefined();
    });

    test('should skip logger and config parameters', () => {
      const availableServices = new Map([['MockService', MockService]]);

      @injectable()
      class TestController {
        constructor(
          private mockService: MockService,
          private logger: any,
          private config: any,
        ) {}
      }

      registerControllerDependencies(TestController, availableServices);
      const deps = getConstructorParamTypes(TestController);
      expect(deps).toBeDefined();
      expect(deps?.length).toBe(1);
      expect(deps?.[0]).toBe(MockService);
    });

    test('should return undefined for class without decorator (no design:paramtypes)', () => {
      const availableServices = new Map([['CounterService', CounterService]]);

      // Without decorator, TypeScript does not emit design:paramtypes
      class TestControllerWithoutDecorator {
        constructor(private counterService: CounterService) {}
      }

      registerControllerDependencies(TestControllerWithoutDecorator, availableServices);
      const deps = getConstructorParamTypes(TestControllerWithoutDecorator);
      // Without decorator, design:paramtypes is not available
      expect(deps).toBeUndefined();
    });
  });

  describe('Inject decorator', () => {
    test('should register explicit dependency', () => {
      class MockService {}

      class TestController {
        constructor(@Inject(MockService) private service: MockService) {}
      }

      const deps = getConstructorParamTypes(TestController);
      expect(deps).toBeDefined();
      expect(deps?.[0]).toBe(MockService);
    });

    test('should handle multiple injected dependencies', () => {
      class ServiceA {}
      class ServiceB {}

      class TestController {
        constructor(
          @Inject(ServiceA) private serviceA: ServiceA,
          @Inject(ServiceB) private serviceB: ServiceB,
        ) {}
      }

      const deps = getConstructorParamTypes(TestController);
      expect(deps).toBeDefined();
      expect(deps?.[0]).toBe(ServiceA);
      expect(deps?.[1]).toBe(ServiceB);
    });

    test('should extend existing dependencies array', () => {
      class ServiceA {}
      class ServiceB {}

      class TestController {
        constructor(
          @Inject(ServiceA) private serviceA: ServiceA,
          @Inject(ServiceB) private serviceB: ServiceB,
        ) {}
      }

      const deps = getConstructorParamTypes(TestController);
      expect(deps?.length).toBe(2);
    });
  });

  describe('registerDependencies', () => {
    test('should manually register dependencies', () => {
      class ServiceA {}
      class ServiceB {}
      class TestController {}

      registerDependencies(TestController, [ServiceA, ServiceB]);
      const deps = getConstructorParamTypes(TestController);
      expect(deps).toEqual([ServiceA, ServiceB]);
    });
  });

  describe('HTTP method decorators', () => {
    test('should register GET route', () => {
      @Controller('test')
      class TestController {
        @Get('hello')
        getHello() {
          return 'hello';
        }
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes).toHaveLength(1);
      expect(metadata?.routes[0].method).toBe(HttpMethod.GET);
      expect(metadata?.routes[0].path).toBe('/hello');
      expect(metadata?.routes[0].handler).toBe('getHello');
    });

    test('should register POST route', () => {
      @Controller()
      class TestController {
        @Post('create')
        create() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].method).toBe(HttpMethod.POST);
    });

    test('should register PUT route', () => {
      @Controller()
      class TestController {
        @Put('update')
        update() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].method).toBe(HttpMethod.PUT);
    });

    test('should register DELETE route', () => {
      @Controller()
      class TestController {
        @Delete('remove')
        remove() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].method).toBe(HttpMethod.DELETE);
    });

    test('should register PATCH route', () => {
      @Controller()
      class TestController {
        @Patch('partial')
        partial() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].method).toBe(HttpMethod.PATCH);
    });

    test('should register OPTIONS route', () => {
      @Controller()
      class TestController {
        @Options('options')
        options() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].method).toBe(HttpMethod.OPTIONS);
    });

    test('should register HEAD route', () => {
      @Controller()
      class TestController {
        @Head('head')
        head() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].method).toBe(HttpMethod.HEAD);
    });

    test('should register ALL route', () => {
      @Controller()
      class TestController {
        @All('all')
        all() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].method).toBe(HttpMethod.ALL);
    });

    test('should handle empty path in route decorator', () => {
      @Controller()
      class TestController {
        @Get()
        root() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].path).toBe('/');
    });

    test('should ensure route path starts with slash', () => {
      @Controller()
      class TestController {
        @Get('test')
        test() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata?.routes[0].path).toBe('/test');
    });

    test('should create metadata for controller without explicit controller decorator', () => {
      class TestController {
        @Get('test')
        test() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata).toBeDefined();
      expect(metadata?.path).toBe('/');
      expect(metadata?.routes).toHaveLength(1);
    });
  });

  describe('parameter decorators', () => {
    test('should register path parameters', () => {
      @Controller()
      class TestController {
        @Get(':id')
        getById(@Param('id') id: string) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params).toHaveLength(1);
      expect(route?.params?.[0].type).toBe(ParamType.PATH);
      expect(route?.params?.[0].name).toBe('id');
      expect(route?.params?.[0].index).toBe(0);
    });

    test('should register query parameters', () => {
      @Controller()
      class TestController {
        @Get()
        search(@Query('filter') filter: string) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params?.[0].type).toBe(ParamType.QUERY);
      expect(route?.params?.[0].name).toBe('filter');
    });

    test('should register body parameters', () => {
      @Controller()
      class TestController {
        @Post()
        create(@Body() data: any) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params?.[0].type).toBe(ParamType.BODY);
    });

    test('should register header parameters', () => {
      @Controller()
      class TestController {
        @Get()
        getWithAuth(@Header('Authorization') auth: string) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params?.[0].type).toBe(ParamType.HEADER);
      expect(route?.params?.[0].name).toBe('Authorization');
    });

    test('should register request object parameter', () => {
      @Controller()
      class TestController {
        @Get()
        getWithReq(@Req() req: any) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params?.[0].type).toBe(ParamType.REQUEST);
    });

    test('should register response object parameter', () => {
      @Controller()
      class TestController {
        @Get()
        getWithRes(@Res() res: any) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params?.[0].type).toBe(ParamType.RESPONSE);
    });

    test('should handle parameter with schema (optional by default for Query)', () => {
      @Controller()
      class TestController {
        @Get()
        test(
          @Query('filter', type('string')) filter: string,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(false); // Query is optional by default
      expect(param?.schema).toBeDefined();
    });

    test('should make Query required with { required: true } option', () => {
      @Controller()
      class TestController {
        @Get()
        test(
          @Query('filter', { required: true }) filter: string,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(true);
    });

    test('should make Query with schema required with { required: true } option', () => {
      @Controller()
      class TestController {
        @Get()
        test(
          @Query('filter', type('string'), { required: true }) filter: string,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(true);
      expect(param?.schema).toBeDefined();
    });

    test('should make Header optional by default', () => {
      @Controller()
      class TestController {
        @Get()
        test(
          @Header('X-Token') token: string,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(false);
    });

    test('should make Header required with { required: true } option', () => {
      @Controller()
      class TestController {
        @Get()
        test(
          @Header('Authorization', { required: true }) auth: string,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(true);
    });

    test('should make Param always required (OpenAPI spec)', () => {
      @Controller()
      class TestController {
        @Get(':id')
        test(
          @Param('id') id: string,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(true);
    });

    test('should determine Body required from schema (not accepting undefined)', () => {
      const bodySchema = type({ name: 'string' });

      @Controller()
      class TestController {
        @Post()
        test(
          @Body(bodySchema) data: { name: string },
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(true); // Schema doesn't accept undefined
    });

    test('should determine Body optional from schema (accepting undefined)', () => {
      const bodySchema = type({ name: 'string' }).or(type.undefined);

      @Controller()
      class TestController {
        @Post()
        test(
          @Body(bodySchema) data: { name: string } | undefined,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(false); // Schema accepts undefined
    });

    test('should allow explicit override of Body required', () => {
      const bodySchema = type({ name: 'string' });

      @Controller()
      class TestController {
        @Post()
        test(
          @Body(bodySchema, { required: false }) data: { name: string },
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      const param = route?.params?.[0];
      expect(param?.isRequired).toBe(false); // Explicitly set to optional
    });

    test('should handle multiple parameters', () => {
      @Controller()
      class TestController {
        @Get(':id')
        test(
          @Param('id') id: string,
          @Query('filter') filter: string,
          @Body() data: any,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params).toHaveLength(3);
      // Parameters are stored in reverse order due to decorator execution order
      expect(route?.params?.find(p => p.type === ParamType.PATH)?.index).toBe(0);
      expect(route?.params?.find(p => p.type === ParamType.QUERY)?.index).toBe(1);
      expect(route?.params?.find(p => p.type === ParamType.BODY)?.index).toBe(2);
    });

    test('should use empty string as default name when not provided', () => {
      @Controller()
      class TestController {
        @Get()
        test(@Body() data: any) {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.params?.[0].name).toBe('');
    });
  });

  describe('UseMiddleware decorator', () => {
    const middleware1 = () => {};
    const middleware2 = () => {};

    test('should register middleware for method', () => {
      @Controller()
      class TestController {
        @Get()
        @UseMiddleware(middleware1)
        test() {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.middleware).toContain(middleware1);
    });

    test('should register multiple middleware functions', () => {
      @Controller()
      class TestController {
        @Get()
        @UseMiddleware(middleware1, middleware2)
        test() {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.middleware).toContain(middleware1);
      expect(route?.middleware).toContain(middleware2);
    });

    test('should append to existing middleware', () => {
      @Controller()
      class TestController {
        @Get()
        @UseMiddleware(middleware1)
        @UseMiddleware(middleware2)
        test() {}
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.middleware).toHaveLength(2);
    });
  });

  describe('Module decorator', () => {
    test('should register module metadata', () => {
      class TestController {}
      class TestService {}

      @Module({
        controllers: [TestController],
        providers: [TestService],
      })
      class TestModule {}

      const metadata = getModuleMetadata(TestModule);
      expect(metadata).toBeDefined();
      expect(metadata?.controllers).toContain(TestController);
      expect(metadata?.providers).toContain(TestService);
    });

    test('should handle all module options', () => {
      class ImportedModule {}
      class TestController {}
      class TestService {}
      class ExportedService {}

      @Module({
        imports: [ImportedModule],
        controllers: [TestController],
        providers: [TestService],
        exports: [ExportedService],
      })
      class TestModule {}

      const metadata = getModuleMetadata(TestModule);
      expect(metadata?.imports).toContain(ImportedModule);
      expect(metadata?.controllers).toContain(TestController);
      expect(metadata?.providers).toContain(TestService);
      expect(metadata?.exports).toContain(ExportedService);
    });

    test('should handle empty module options', () => {
      @Module({})
      class EmptyModule {}

      const metadata = getModuleMetadata(EmptyModule);
      expect(metadata).toBeDefined();
    });

    test('should return undefined for non-module class', () => {
      class NotAModule {}

      const metadata = getModuleMetadata(NotAModule);
      expect(metadata).toBeUndefined();
    });
  });

  describe('getControllerMetadata', () => {
    test('should return undefined for non-controller class', () => {
      class NotAController {}

      const metadata = getControllerMetadata(NotAController);
      expect(metadata).toBeUndefined();
    });

    test('should return metadata for controller with routes', () => {
      @Controller('api')
      class TestController {
        @Get('test')
        test() {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata).toBeDefined();
      expect(metadata?.path).toBe('/api');
      expect(metadata?.routes).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    test('should handle class without constructor in dependency detection', () => {
      class TestController {}

      const availableServices = new Map();
      registerControllerDependencies(TestController, availableServices);
      const deps = getConstructorParamTypes(TestController);
      expect(deps).toBeUndefined();
    });

    test('should handle malformed constructor in dependency detection', () => {
      // Simulate a class with malformed constructor string
      const malformedClass = function() {} as any;
      malformedClass.toString = () => 'class Test { invalidConstructor }';

      const availableServices = new Map();
      registerControllerDependencies(malformedClass, availableServices);
      const deps = getConstructorParamTypes(malformedClass);
      expect(deps).toBeUndefined();
    });

    test('should properly inject module service into controller without @Inject', async () => {
      // Mock Bun.serve to avoid starting a real server
      const originalServe = Bun.serve;
       
      (Bun as any).serve = mock(() => ({
        stop: mock(),
        port: 3000,
      }));

      try {
        @Service()
        class TestService extends BaseService {
          getValue() {
            return 'injected-value';
          }
        }

        // No @Inject needed - automatic DI via emitDecoratorMetadata
        @Controller('')
        class TestController extends BaseController {
          constructor(private service: TestService) {
            super();
          }

          getServiceValue() {
            return this.service.getValue();
          }
        }

        @Module({
          controllers: [TestController],
          providers: [TestService],
        })
        class TestModule {}

        const app = new OneBunApplication(TestModule, {
          loggerLayer: makeMockLoggerLayer(),
        });

        // start() creates rootModule and calls setup, triggering dependency injection
        await app.start();

        // Access rootModule after start to verify DI
         
        const rootModule = (app as any).rootModule;

        // Get controller instance and verify service was injected
        const controllerInstance = rootModule.getControllerInstance(TestController) as TestController;

        expect(controllerInstance).toBeDefined();
        expect(controllerInstance).toBeInstanceOf(TestController);

        // Verify the injected service works correctly
        expect(controllerInstance.getServiceValue()).toBe('injected-value');
      } finally {
         
        (Bun as any).serve = originalServe;
      }
    });
  });

  describe('ApiResponse decorator', () => {
    test('should register response schema metadata', () => {
      @Controller()
      class TestController {
        @Get()
        @ApiResponse(200, { schema: type('string') })
        test(): string {
          return 'test';
        }
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.responseSchemas).toBeDefined();
      expect(route?.responseSchemas?.length).toBe(1);
      expect(route?.responseSchemas?.[0].statusCode).toBe(200);
      expect(route?.responseSchemas?.[0].schema).toBeDefined();
    });

    test('should register multiple response schemas', () => {
      @Controller()
      class TestController {
        @Get()
        @ApiResponse(200, { schema: type('string') })
        @ApiResponse(404, { schema: type('object'), description: 'Not found' })
        test(): string {
          return 'test';
        }
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.responseSchemas?.length).toBe(2);
      // Order might vary, so check both
      const statusCodes = route?.responseSchemas?.map(rs => rs.statusCode) || [];
      expect(statusCodes).toContain(200);
      expect(statusCodes).toContain(404);
      const notFoundSchema = route?.responseSchemas?.find(rs => rs.statusCode === 404);
      expect(notFoundSchema?.description).toBe('Not found');
    });

    test('should work without schema', () => {
      @Controller()
      class TestController {
        @Get()
        @ApiResponse(200, { description: 'Success' })
        test(): string {
          return 'test';
        }
      }

      const metadata = getControllerMetadata(TestController);
      const route = metadata?.routes[0];
      expect(route?.responseSchemas?.length).toBe(1);
      expect(route?.responseSchemas?.[0].statusCode).toBe(200);
      expect(route?.responseSchemas?.[0].schema).toBeUndefined();
      expect(route?.responseSchemas?.[0].description).toBe('Success');
    });
  });

  describe('Global decorator', () => {
    // Import the functions we need to test
    const {
      Global,
      isGlobalModule,
      removeFromGlobalModules,
      clearGlobalModules,
    } = require('./decorators');

    beforeEach(() => {
      // Clear global modules before each test
      clearGlobalModules();
    });

    afterEach(() => {
      // Clean up after each test
      clearGlobalModules();
    });

    test('should mark module as global', () => {
      @Global()
      @Module({})
      class GlobalTestModule {}

      expect(isGlobalModule(GlobalTestModule)).toBe(true);
    });

    test('should return false for non-global module', () => {
      @Module({})
      class NonGlobalModule {}

      expect(isGlobalModule(NonGlobalModule)).toBe(false);
    });

    test('should return false for class without decorator', () => {
      class PlainClass {}

      expect(isGlobalModule(PlainClass)).toBe(false);
    });

    test('should work with @Global before @Module', () => {
      @Global()
      @Module({
        providers: [],
        exports: [],
      })
      class GlobalFirstModule {}

      expect(isGlobalModule(GlobalFirstModule)).toBe(true);
    });

    test('should work with @Module before @Global', () => {
      // Note: In TypeScript, decorators are applied bottom-up,
      // so @Module is applied first, then @Global
      @Module({})
      @Global()
      class ModuleFirstModule {}

      expect(isGlobalModule(ModuleFirstModule)).toBe(true);
    });

    test('should allow removing module from global registry', () => {
      @Global()
      @Module({})
      class RemovableModule {}

      expect(isGlobalModule(RemovableModule)).toBe(true);

      removeFromGlobalModules(RemovableModule);

      expect(isGlobalModule(RemovableModule)).toBe(false);
    });

    test('should handle removing non-existent module gracefully', () => {
      class NonExistentModule {}

      // Should not throw
      expect(() => removeFromGlobalModules(NonExistentModule)).not.toThrow();
      expect(isGlobalModule(NonExistentModule)).toBe(false);
    });

    test('should clear all global modules', () => {
      @Global()
      @Module({})
      class GlobalModule1 {}

      @Global()
      @Module({})
      class GlobalModule2 {}

      expect(isGlobalModule(GlobalModule1)).toBe(true);
      expect(isGlobalModule(GlobalModule2)).toBe(true);

      clearGlobalModules();

      expect(isGlobalModule(GlobalModule1)).toBe(false);
      expect(isGlobalModule(GlobalModule2)).toBe(false);
    });

    test('should preserve module metadata when using @Global', () => {
      class TestService {}
      class TestController {}

      @Global()
      @Module({
        providers: [TestService],
        exports: [TestService],
        controllers: [TestController],
      })
      class GlobalModuleWithMetadata {}

      // Module should be global
      expect(isGlobalModule(GlobalModuleWithMetadata)).toBe(true);

      // Module metadata should be preserved
      const metadata = getModuleMetadata(GlobalModuleWithMetadata);
      expect(metadata).toBeDefined();
      expect(metadata?.providers).toContain(TestService);
      expect(metadata?.exports).toContain(TestService);
      expect(metadata?.controllers).toContain(TestController);
    });

    test('should handle multiple @Global decorators on different modules', () => {
      @Global()
      @Module({})
      class GlobalModuleA {}

      @Global()
      @Module({})
      class GlobalModuleB {}

      @Module({})
      class NonGlobalModuleC {}

      expect(isGlobalModule(GlobalModuleA)).toBe(true);
      expect(isGlobalModule(GlobalModuleB)).toBe(true);
      expect(isGlobalModule(NonGlobalModuleC)).toBe(false);
    });
  });

  // ============================================================================
  // File Upload Decorators
  // ============================================================================

  describe('File Upload Decorators', () => {
    test('@UploadedFile should store FILE param metadata', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/upload')
        upload(@UploadedFile('avatar') _file: unknown) {}
      }

      const metadata = getControllerMetadata(TestController);
      expect(metadata).toBeDefined();
      const route = metadata!.routes[0];
      expect(route.params).toBeDefined();
      expect(route.params!.length).toBe(1);
      expect(route.params![0].type).toBe(ParamType.FILE);
      expect(route.params![0].name).toBe('avatar');
      expect(route.params![0].index).toBe(0);
      expect(route.params![0].isRequired).toBe(true);
    });

    test('@UploadedFile should store file options', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/upload')
        upload(
          @UploadedFile('avatar', { maxSize: 1024, mimeTypes: ['image/*'], required: false }) _file: unknown,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const param = metadata!.routes[0].params![0];
      expect(param.isRequired).toBe(false);
      expect(param.fileOptions).toBeDefined();
      expect(param.fileOptions!.maxSize).toBe(1024);
      expect(param.fileOptions!.mimeTypes).toEqual(['image/*']);
    });

    test('@UploadedFile without options should be required by default', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/upload')
        upload(@UploadedFile('file') _file: unknown) {}
      }

      const metadata = getControllerMetadata(TestController);
      const param = metadata!.routes[0].params![0];
      expect(param.isRequired).toBe(true);
      expect(param.fileOptions).toBeUndefined();
    });

    test('@UploadedFiles should store FILES param metadata', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/upload')
        upload(@UploadedFiles('docs', { maxCount: 5, maxSize: 2048 }) _files: unknown) {}
      }

      const metadata = getControllerMetadata(TestController);
      const param = metadata!.routes[0].params![0];
      expect(param.type).toBe(ParamType.FILES);
      expect(param.name).toBe('docs');
      expect(param.isRequired).toBe(true);
      expect(param.fileOptions!.maxCount).toBe(5);
      expect(param.fileOptions!.maxSize).toBe(2048);
    });

    test('@UploadedFiles without field name should have empty name', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/upload')
        upload(@UploadedFiles() _files: unknown) {}
      }

      const metadata = getControllerMetadata(TestController);
      const param = metadata!.routes[0].params![0];
      expect(param.type).toBe(ParamType.FILES);
      expect(param.name).toBe('');
    });

    test('@FormField should store FORM_FIELD param metadata', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/upload')
        upload(@FormField('name') _name: unknown) {}
      }

      const metadata = getControllerMetadata(TestController);
      const param = metadata!.routes[0].params![0];
      expect(param.type).toBe(ParamType.FORM_FIELD);
      expect(param.name).toBe('name');
      expect(param.isRequired).toBe(false);
    });

    test('@FormField with required option', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/upload')
        upload(@FormField('name', { required: true }) _name: unknown) {}
      }

      const metadata = getControllerMetadata(TestController);
      const param = metadata!.routes[0].params![0];
      expect(param.isRequired).toBe(true);
    });

    test('should support mixing file and form field decorators', () => {
      @Controller('/test')
      class TestController extends BaseController {
        @Post('/profile')
        createProfile(
          @UploadedFile('avatar') _avatar: unknown,
          @FormField('name', { required: true }) _name: unknown,
          @FormField('email') _email: unknown,
        ) {}
      }

      const metadata = getControllerMetadata(TestController);
      const params = metadata!.routes[0].params!;
      expect(params.length).toBe(3);

      const fileParam = params.find((p) => p.type === ParamType.FILE);
      const nameParam = params.find((p) => p.name === 'name');
      const emailParam = params.find((p) => p.name === 'email');

      expect(fileParam).toBeDefined();
      expect(nameParam).toBeDefined();
      expect(nameParam!.type).toBe(ParamType.FORM_FIELD);
      expect(nameParam!.isRequired).toBe(true);
      expect(emailParam).toBeDefined();
      expect(emailParam!.isRequired).toBe(false);
    });
  });
});
