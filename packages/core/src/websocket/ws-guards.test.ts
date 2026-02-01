/**
 * WebSocket Guards Tests
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import type { WsClientData, WsHandlerMetadata } from './ws.types';

import {
  WsAuthGuard,
  WsPermissionGuard,
  WsRoomGuard,
  WsAnyPermissionGuard,
  WsServiceGuard,
  WsAllGuards,
  WsAnyGuard,
  WsExecutionContextImpl,
  executeGuards,
  createGuard,
} from './ws-guards';
import { WsHandlerType } from './ws.types';

describe('ws-guards', () => {
  // Helper to create mock client data
  const createClient = (overrides: Partial<WsClientData> = {}): WsClientData => ({
    id: 'test-client',
    rooms: [],
    connectedAt: Date.now(),
    auth: null,
    metadata: {},
    ...overrides,
  });

  // Helper to create mock handler metadata
  const createHandler = (): WsHandlerMetadata => ({
    type: WsHandlerType.MESSAGE,
    pattern: 'test:*',
    handler: 'handleTest',
    params: [],
  });

  // Helper to create execution context
  const createContext = (client: WsClientData) =>
    new WsExecutionContextImpl(
      client,
      {} as never, // mock socket
      {},
      createHandler(),
      {},
    );

  describe('WsAuthGuard', () => {
    const guard = new WsAuthGuard();

    it('should allow authenticated clients', () => {
      const client = createClient({
        auth: { authenticated: true },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should reject unauthenticated clients', () => {
      const client = createClient({
        auth: { authenticated: false },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should reject clients without auth data', () => {
      const client = createClient({ auth: null });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  describe('WsPermissionGuard', () => {
    it('should allow clients with required permission', () => {
      const guard = new WsPermissionGuard('admin');
      const client = createClient({
        auth: { authenticated: true, permissions: ['admin', 'user'] },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should reject clients without required permission', () => {
      const guard = new WsPermissionGuard('admin');
      const client = createClient({
        auth: { authenticated: true, permissions: ['user'] },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should require all permissions when array is provided', () => {
      const guard = new WsPermissionGuard(['admin', 'moderator']);
      const client = createClient({
        auth: { authenticated: true, permissions: ['admin'] },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should allow when client has all required permissions', () => {
      const guard = new WsPermissionGuard(['admin', 'moderator']);
      const client = createClient({
        auth: { authenticated: true, permissions: ['admin', 'moderator', 'user'] },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('WsRoomGuard', () => {
    it('should allow clients in the required room', () => {
      const guard = new WsRoomGuard('vip');
      const client = createClient({
        rooms: ['general', 'vip'],
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should reject clients not in the required room', () => {
      const guard = new WsRoomGuard('vip');
      const client = createClient({
        rooms: ['general'],
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  describe('WsAnyPermissionGuard', () => {
    it('should allow clients with any of the permissions', () => {
      const guard = new WsAnyPermissionGuard(['admin', 'moderator']);
      const client = createClient({
        auth: { authenticated: true, permissions: ['moderator'] },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should reject clients without any of the permissions', () => {
      const guard = new WsAnyPermissionGuard(['admin', 'moderator']);
      const client = createClient({
        auth: { authenticated: true, permissions: ['user'] },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(false);
    });
  });

  describe('WsServiceGuard', () => {
    it('should allow allowed services', () => {
      const guard = new WsServiceGuard('payment-service');
      const client = createClient({
        auth: { authenticated: true, serviceId: 'payment-service' },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });

    it('should reject non-allowed services', () => {
      const guard = new WsServiceGuard('payment-service');
      const client = createClient({
        auth: { authenticated: true, serviceId: 'other-service' },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(false);
    });

    it('should allow multiple services', () => {
      const guard = new WsServiceGuard(['payment-service', 'billing-service']);
      const client = createClient({
        auth: { authenticated: true, serviceId: 'billing-service' },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('WsAllGuards', () => {
    it('should pass when all guards pass', async () => {
      const guard = new WsAllGuards([new WsAuthGuard(), new WsPermissionGuard('admin')]);

      const client = createClient({
        auth: { authenticated: true, permissions: ['admin'] },
      });
      const context = createContext(client);

      expect(await guard.canActivate(context)).toBe(true);
    });

    it('should fail when any guard fails', async () => {
      const guard = new WsAllGuards([new WsAuthGuard(), new WsPermissionGuard('admin')]);

      const client = createClient({
        auth: { authenticated: true, permissions: ['user'] },
      });
      const context = createContext(client);

      expect(await guard.canActivate(context)).toBe(false);
    });
  });

  describe('WsAnyGuard', () => {
    it('should pass when any guard passes', async () => {
      const guard = new WsAnyGuard([new WsPermissionGuard('admin'), new WsRoomGuard('vip')]);

      const client = createClient({
        auth: { authenticated: true, permissions: ['user'] },
        rooms: ['vip'],
      });
      const context = createContext(client);

      expect(await guard.canActivate(context)).toBe(true);
    });

    it('should fail when all guards fail', async () => {
      const guard = new WsAnyGuard([new WsPermissionGuard('admin'), new WsRoomGuard('vip')]);

      const client = createClient({
        auth: { authenticated: true, permissions: ['user'] },
        rooms: ['general'],
      });
      const context = createContext(client);

      expect(await guard.canActivate(context)).toBe(false);
    });
  });

  describe('executeGuards', () => {
    it('should execute guard classes', async () => {
      const client = createClient({
        auth: { authenticated: true },
      });
      const context = createContext(client);

      const result = await executeGuards([WsAuthGuard], context);
      expect(result).toBe(true);
    });

    it('should execute guard instances', async () => {
      const client = createClient({
        auth: { authenticated: true, permissions: ['admin'] },
      });
      const context = createContext(client);

      const result = await executeGuards([new WsPermissionGuard('admin')], context);
      expect(result).toBe(true);
    });

    it('should return true when no guards', async () => {
      const context = createContext(createClient());
      const result = await executeGuards([], context);
      expect(result).toBe(true);
    });
  });

  describe('createGuard', () => {
    it('should create custom guard from function', () => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const CustomGuard = createGuard((ctx) => {
        return (ctx.getClient().metadata as { customCheck?: boolean }).customCheck === true;
      });

      const guard = new CustomGuard();
      const client = createClient({
        metadata: { customCheck: true },
      });
      const context = createContext(client);

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('WsExecutionContextImpl', () => {
    it('should provide access to client data', () => {
      const client = createClient({ id: 'test-id' });
      const context = createContext(client);

      expect(context.getClient().id).toBe('test-id');
    });

    it('should provide access to message data', () => {
      const client = createClient();
      const data = { text: 'hello' };
      const context = new WsExecutionContextImpl(
        client,
        {} as never,
        data,
        createHandler(),
        {},
      );

      expect(context.getData<{ text: string }>()).toEqual(data);
    });

    it('should provide access to pattern params', () => {
      const client = createClient();
      const params = { roomId: '123' };
      const context = new WsExecutionContextImpl(
        client,
        {} as never,
        {},
        createHandler(),
        params,
      );

      expect(context.getPatternParams()).toEqual(params);
    });
  });
});
