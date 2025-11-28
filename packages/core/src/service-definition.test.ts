import {
  describe,
  expect,
  test,
} from 'bun:test';

import {
  Controller,
  Get,
  Module,
  Param,
  Post,
  Body,
} from './decorators';
import { createServiceDefinition } from './service-definition';
import { HttpMethod } from './types';

// Test controller
@Controller('/users')
class UsersController {
  @Get('/')
  getAll() {
    return [];
  }

  @Get('/:id')
  getById(@Param('id') _id: string) {
    return {};
  }

  @Post('/')
  create(@Body() _body: unknown) {
    return {};
  }
}

@Controller('/orders')
class OrdersController {
  @Get('/')
  list() {
    return [];
  }
}

// Test modules
@Module({
  controllers: [UsersController],
})
class UsersModule {}

@Module({
  controllers: [OrdersController],
})
class OrdersModule {}

@Module({
  imports: [UsersModule, OrdersModule],
  controllers: [],
})
class AppModule {}

// Module without decorator
class NonDecoratedModule {}

describe('createServiceDefinition', () => {
  describe('basic functionality', () => {
    test('should create definition from module with controllers', () => {
      const definition = createServiceDefinition(UsersModule);

      expect(definition).toBeDefined();
      expect(definition._module).toBe(UsersModule);
      expect(definition._endpoints.length).toBeGreaterThan(0);
      expect(definition._controllers.size).toBe(1);
    });

    test('should collect endpoints from controller', () => {
      const definition = createServiceDefinition(UsersModule);

      // Find the UsersController
      const usersControllerDef = definition._controllers.get('UsersController');
      expect(usersControllerDef).toBeDefined();
      expect(usersControllerDef!.methods.size).toBe(3); // getAll, getById, create
    });

    test('should include path params in endpoint metadata', () => {
      const definition = createServiceDefinition(UsersModule);
      const usersControllerDef = definition._controllers.get('UsersController');
      const getByIdEndpoint = usersControllerDef!.methods.get('getById');

      expect(getByIdEndpoint).toBeDefined();
      expect(getByIdEndpoint!.path).toBe('/users/:id');
      expect(getByIdEndpoint!.params).toBeDefined();
    });
  });

  describe('imported modules', () => {
    test('should collect endpoints from imported modules recursively', () => {
      const definition = createServiceDefinition(AppModule);

      // Should have both UsersController and OrdersController
      expect(definition._controllers.size).toBe(2);
      expect(definition._controllers.has('UsersController')).toBe(true);
      expect(definition._controllers.has('OrdersController')).toBe(true);
    });

    test('should include all endpoints from all imported modules', () => {
      const definition = createServiceDefinition(AppModule);

      // UsersController: 3 endpoints, OrdersController: 1 endpoint
      expect(definition._endpoints.length).toBe(4);
    });
  });

  describe('error handling', () => {
    test('should throw for non-decorated module', () => {
      expect(() => createServiceDefinition(NonDecoratedModule)).toThrow(
        'NonDecoratedModule is not decorated with @Module',
      );
    });
  });

  describe('endpoint metadata', () => {
    test('should include correct HTTP method', () => {
      const definition = createServiceDefinition(UsersModule);
      const usersControllerDef = definition._controllers.get('UsersController');

      const getAllEndpoint = usersControllerDef!.methods.get('getAll');
      expect(getAllEndpoint!.httpMethod).toBe(HttpMethod.GET);

      const createEndpoint = usersControllerDef!.methods.get('create');
      expect(createEndpoint!.httpMethod).toBe(HttpMethod.POST);
    });

    test('should include correct path', () => {
      const definition = createServiceDefinition(UsersModule);
      const usersControllerDef = definition._controllers.get('UsersController');

      const getAllEndpoint = usersControllerDef!.methods.get('getAll');
      expect(getAllEndpoint!.path).toBe('/users/');

      const getByIdEndpoint = usersControllerDef!.methods.get('getById');
      expect(getByIdEndpoint!.path).toBe('/users/:id');
    });

    test('should include controller name', () => {
      const definition = createServiceDefinition(UsersModule);

      for (const endpoint of definition._endpoints) {
        if (endpoint.controller === 'UsersController') {
          expect(['getAll', 'getById', 'create']).toContain(endpoint.method);
        }
      }
    });
  });
});
