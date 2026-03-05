import { describe, expect, it } from 'bun:test';

import type { HttpExecutionContext, HttpGuard } from '../types';
import {
  AuthGuard,
  createHttpGuard,
  executeHttpGuards,
  HttpExecutionContextImpl,
  RolesGuard,
} from './http-guards';

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', { headers });
}

function makeContext(
  headers: Record<string, string> = {},
  handler = 'testHandler',
  controller = 'TestController',
): HttpExecutionContext {
  return new HttpExecutionContextImpl(
    makeRequest(headers) as import('../types').OneBunRequest,
    handler,
    controller,
  );
}

// ============================================================================
// HttpExecutionContextImpl
// ============================================================================

describe('HttpExecutionContextImpl', () => {
  it('returns request from getRequest()', () => {
    const req = makeRequest({ authorization: 'Bearer token' });
    const ctx = new HttpExecutionContextImpl(
      req as import('../types').OneBunRequest,
      'myHandler',
      'MyController',
    );

    expect(ctx.getRequest()).toBe(req);
  });

  it('returns handler name from getHandler()', () => {
    const ctx = makeContext({}, 'getUser', 'UserController');

    expect(ctx.getHandler()).toBe('getUser');
  });

  it('returns controller name from getController()', () => {
    const ctx = makeContext({}, 'getUser', 'UserController');

    expect(ctx.getController()).toBe('UserController');
  });
});

// ============================================================================
// executeHttpGuards
// ============================================================================

describe('executeHttpGuards', () => {
  it('returns true when there are no guards', async () => {
    const ctx = makeContext();

    expect(await executeHttpGuards([], ctx)).toBe(true);
  });

  it('returns true when all guards pass', async () => {
    const PassGuard = createHttpGuard(() => true);
    const ctx = makeContext();

    expect(await executeHttpGuards([PassGuard, PassGuard], ctx)).toBe(true);
  });

  it('returns false when any guard fails', async () => {
    const PassGuard = createHttpGuard(() => true);
    const FailGuard = createHttpGuard(() => false);
    const ctx = makeContext();

    expect(await executeHttpGuards([PassGuard, FailGuard, PassGuard], ctx)).toBe(false);
  });

  it('short-circuits on first failing guard', async () => {
    let secondCalled = false;

    const FailGuard = createHttpGuard(() => false);
    const TrackGuard = createHttpGuard(() => {
      secondCalled = true;

      return true;
    });
    const ctx = makeContext();

    await executeHttpGuards([FailGuard, TrackGuard], ctx);

    expect(secondCalled).toBe(false);
  });

  it('accepts guard instances (not just class constructors)', async () => {
    const instance: HttpGuard = { canActivate: () => true };
    const ctx = makeContext();

    expect(await executeHttpGuards([instance], ctx)).toBe(true);
  });

  it('accepts async guards', async () => {
    const AsyncPassGuard = createHttpGuard(async () => {
      await Promise.resolve();

      return true;
    });
    const ctx = makeContext();

    expect(await executeHttpGuards([AsyncPassGuard], ctx)).toBe(true);
  });
});

// ============================================================================
// createHttpGuard
// ============================================================================

describe('createHttpGuard', () => {
  it('returns a class constructor', () => {
    const Guard = createHttpGuard(() => true);

    expect(typeof Guard).toBe('function');
  });

  it('instantiated class calls the provided function', async () => {
    let called = false;
    const Guard = createHttpGuard((ctx) => {
      called = true;

      return ctx.getHandler() === 'target';
    });
    const ctx = makeContext({}, 'target');
    const instance = new Guard();

    expect(await instance.canActivate(ctx)).toBe(true);
    expect(called).toBe(true);
  });
});

// ============================================================================
// AuthGuard
// ============================================================================

describe('AuthGuard', () => {
  it('allows request with Bearer token', () => {
    const guard = new AuthGuard();
    const ctx = makeContext({ authorization: 'Bearer my-token' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks request without Authorization header', () => {
    const guard = new AuthGuard();
    const ctx = makeContext();

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('blocks request with non-Bearer Authorization header', () => {
    const guard = new AuthGuard();
    const ctx = makeContext({ authorization: 'Basic dXNlcjpwYXNz' });

    expect(guard.canActivate(ctx)).toBe(false);
  });
});

// ============================================================================
// RolesGuard
// ============================================================================

describe('RolesGuard', () => {
  it('allows when user has all required roles (default extractor)', () => {
    const guard = new RolesGuard(['admin', 'editor']);
    const ctx = makeContext({ 'x-user-roles': 'admin, editor, viewer' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks when user is missing a required role', () => {
    const guard = new RolesGuard(['admin']);
    const ctx = makeContext({ 'x-user-roles': 'viewer' });

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('blocks when x-user-roles header is absent', () => {
    const guard = new RolesGuard(['admin']);
    const ctx = makeContext();

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('uses custom roles extractor when provided', () => {
    const guard = new RolesGuard(['admin'], (ctx) =>
      ctx.getRequest().headers.get('x-roles')?.split('|') ?? [],
    );
    const ctx = makeContext({ 'x-roles': 'admin|user' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('requires ALL roles to be present (not just one)', () => {
    const guard = new RolesGuard(['admin', 'superuser']);
    const ctx = makeContext({ 'x-user-roles': 'admin' });

    expect(guard.canActivate(ctx)).toBe(false);
  });
});
