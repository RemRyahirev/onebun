/**
 * The per-unit-of-work context: reading it, writing it, and the isolation that makes it usable.
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';

import {
  createRequestContext,
  getRequestContext,
  inheritRequestContext,
  requestContextStore,
  updateRequestContext,
} from './request-context';
import { inEntrySpan } from './trace-scope';

// The shape an application would add by declaration merging. Declared locally rather than through
// `declare module '@onebun/core'` because a global augmentation in a test file would leak into
// every other file in the run — and the framework must keep compiling with NO augmentation at all.
interface TestUser {
  id: string;
}

declare module './request-context' {
  interface RequestContext {
    user?: TestUser;
    tenant?: string;
  }
}

describe('getRequestContext', () => {
  it('should answer undefined outside a scope instead of throwing', () => {
    // Shared code — a guard, an interceptor, a service — runs both inside a request and outside
    // one (a lifecycle hook, a preflight short-circuit, /metrics). It must not have to know which.
    expect(getRequestContext()).toBeUndefined();
  });

  it('should answer the context of the scope it is called in, at any depth', () => {
    const seen = requestContextStore.run(createRequestContext(null), () => {
      const deep = (): unknown => ((): unknown => getRequestContext())();

      return deep();
    });

    expect(seen).toEqual({ traceContext: null });
  });
});

describe('updateRequestContext', () => {
  it('should be a no-op returning false outside a scope', () => {
    expect(updateRequestContext({ user: { id: 'u1' } })).toBe(false);
  });

  it('should make a write visible to code deeper in the same scope', () => {
    const seen = requestContextStore.run(createRequestContext(null), () => {
      // What a middleware does...
      const written = updateRequestContext({ user: { id: 'u1' } });

      // ...and what the handler, several awaits later, reads.
      return { written, user: getRequestContext()?.user };
    });

    expect(seen.written).toBe(true);
    expect(seen.user).toEqual({ id: 'u1' });
  });

  it('should make a write from a nested frame visible to the frame that opened the scope', () => {
    // The load-bearing property, and the reason this mutates the stored object rather than
    // replacing it: AsyncLocalStorage propagates a mutation outward, but a replacement is only
    // possible by opening a new scope, whose effect ends with it. A middleware writing a
    // replacement would leave the handler reading the old value.
    const seen = requestContextStore.run(createRequestContext(null), () => {
      const middleware = (): void => {
        updateRequestContext({ tenant: 'acme' });
      };

      middleware();

      return getRequestContext()?.tenant;
    });

    expect(seen).toBe('acme');
  });

  it('should merge rather than replace, leaving members it was not given alone', () => {
    const seen = requestContextStore.run(createRequestContext(null), () => {
      updateRequestContext({ user: { id: 'u1' } });
      updateRequestContext({ tenant: 'acme' });

      return getRequestContext();
    });

    expect(seen?.user).toEqual({ id: 'u1' });
    expect(seen?.tenant).toBe('acme');
    expect(seen?.traceContext).toBeNull();
  });

  it('should keep two overlapping units of work from seeing each other', async () => {
    // The case a singleton field cannot pass: a slow request and a fast one, in flight together.
    const run = async (id: string, delayMs: number): Promise<string | undefined> => await new Promise((resolve) => {
      requestContextStore.run(createRequestContext(null), () => {
        updateRequestContext({ user: { id } });

        setTimeout(() => {
          resolve(getRequestContext()?.user?.id);
        }, delayMs);
      });
    });

    const [slow, fast] = await Promise.all([run('slow', 20), run('fast', 1)]);

    expect(slow).toBe('slow');
    expect(fast).toBe('fast');
  });
});

describe('inheritRequestContext', () => {
  it('should hand a fresh empty context when there is no enclosing scope', () => {
    expect(inheritRequestContext()).toEqual({ traceContext: null });
  });

  it('should copy the enclosing context, so reads are preserved and writes are isolated', () => {
    const outer = createRequestContext(null);

    requestContextStore.run(outer, () => {
      updateRequestContext({ user: { id: 'outer' }, tenant: 'acme' });

      const nested = inheritRequestContext();

      // Every read the nested work used to get from the enclosing store still answers the same.
      expect(nested.user).toEqual({ id: 'outer' });
      expect(nested.tenant).toBe('acme');

      requestContextStore.run(nested, () => {
        updateRequestContext({ user: { id: 'nested' } });
      });

      // ...but the write does not reach back into the work that scheduled it, which is what
      // reading the enclosing store directly used to do.
      expect(getRequestContext()?.user).toEqual({ id: 'outer' });
    });
  });
});

describe('inEntrySpan establishes a scope on both branches', () => {
  it('should give untraced background work a context of its own', () => {
    // No owner: this is a queue delivery, a scheduler tick or a WebSocket frame in an application
    // with tracing off. Before this branch entered the store, there was no context here at all,
    // so "one decorator, three transports" rested on a store only HTTP had.
    const seen = inEntrySpan('queue.delivery', () => {
      const written = updateRequestContext({ tenant: 'from-handler' });

      return { written, tenant: getRequestContext()?.tenant };
    });

    expect(seen.written).toBe(true);
    expect(seen.tenant).toBe('from-handler');
  });

  it('should not let untraced background work write back into the scope that scheduled it', () => {
    requestContextStore.run(createRequestContext(null), () => {
      updateRequestContext({ tenant: 'request' });

      inEntrySpan('queue.delivery', () => {
        updateRequestContext({ tenant: 'handler' });
      });

      expect(getRequestContext()?.tenant).toBe('request');
    });
  });

  it('should still let untraced background work READ what scheduled it, as it always could', () => {
    requestContextStore.run(createRequestContext(null), () => {
      updateRequestContext({ user: { id: 'scheduler' } });

      const seen = inEntrySpan('queue.delivery', () => getRequestContext()?.user);

      expect(seen).toEqual({ id: 'scheduler' });
    });
  });
});
