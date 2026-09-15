/**
 * A constructor parameter the container cannot resolve keeps its SLOT.
 *
 * Reported as onebun-FB-18: an unresolvable parameter was not injected as `undefined` in place,
 * it was DROPPED, and every later parameter slid one position left. Construction succeeded, the
 * object held the wrong dependency in several fields, and nothing was logged or thrown. Every
 * field stayed truthy except the last, so an `if (!this.x)` degradation guard took the WORKING
 * branch with the wrong object and the failure surfaced far away as `x.someMethod is not a
 * function`. Unit tests that construct the service by hand pass their arguments positionally, so
 * they stayed green throughout.
 *
 * The root cause (onebun-FB-19) was a `.filter()` in `getConstructorParamTypes`. There is one
 * fix site, but SIX consumers build an argument list from what it returns, and a fix applied to
 * five of them passes any single-transport test — so every one of them is driven here.
 *
 * An interface is the vehicle throughout because it is the realistic trigger: an interface has no
 * runtime representation, so Bun emits `Object` for it. `any`, `unknown`, a type alias and a
 * reference broken by a circular import all arrive identically, which is why the framework's
 * diagnostics may describe the hole but never explain it.
 */
 

import {
  describe,
  expect,
  test,
} from 'bun:test';
import { Effect } from 'effect';

import type { OneBunRequest } from '../types';

import {
  Controller as CtrlDeco,
  Get,
  Middleware,
  Module,
  Optional,
  UseGuards,
} from '../decorators/decorators';
import { makeMockLoggerLayer } from '../testing/test-utils';

import { Controller } from './controller';
import { BaseMiddleware } from './middleware';
import { OneBunModule } from './module';
import { Service } from './service';

/** No runtime representation whatsoever — this is what reflects as `Object`. */
interface ProducerStatusPort {
  status(): string;
}

@Service()
class DbLike {
  readonly which = 'db';
}

@Service()
class EventsLike {
  readonly which = 'events';
}

@Service()
class RateLimiterLike {
  readonly which = 'rate-limiter';
}

@Service()
class UnblockLike {
  readonly which = 'unblock';
}

/**
 * The reporter's own shape: five parameters, the third one interface-typed.
 *
 * Measured before the fix — `producerPort` held the RateLimiterLike, `rateLimiter` held the
 * UnblockLike, and `unblock` was `undefined` because nothing was left to shift in.
 */
@Service()
class PollService {
  constructor(
    public db: DbLike,
    public events: EventsLike,
    public producerPort?: ProducerStatusPort,
    public rateLimiter?: RateLimiterLike,
    public unblock?: UnblockLike,
  ) {}
}

@Module({ providers: [DbLike, EventsLike, RateLimiterLike, UnblockLike, PollService] })
class PollModule {}

describe('an unresolvable constructor parameter keeps its position', () => {
  test('should not shift later dependencies left in a five-parameter service', () => {
    const module = new OneBunModule(PollModule, makeMockLoggerLayer());
    const poll = module.getServiceByClass(PollService);

    expect(poll).toBeDefined();
    expect(poll?.db).toBeInstanceOf(DbLike);
    expect(poll?.events).toBeInstanceOf(EventsLike);

    // The hole. Before the fix this held the RateLimiterLike.
    expect(poll?.producerPort).toBeUndefined();

    // The two that used to be pulled left, each back in its declared slot.
    expect(poll?.rateLimiter).toBeInstanceOf(RateLimiterLike);
    expect(poll?.unblock).toBeInstanceOf(UnblockLike);
  });

  test('should hand an interface-typed parameter undefined, NOT the first service in the map', () => {
    // The test that catches a naive fix. Removing the filter without also refusing `Object` in
    // the resolver is WORSE than the shift: the resolver's last fallback answers
    // `instance instanceof type`, and `instanceof Object` is true for every service instance —
    // so this parameter would silently receive whichever service was registered first.
    interface Unresolvable {
      nothing(): void;
    }

    @Service()
    class LonelyService {
      constructor(public port?: Unresolvable) {}
    }

    @Module({ providers: [DbLike, EventsLike, LonelyService] })
    class LonelyModule {}

    const module = new OneBunModule(LonelyModule, makeMockLoggerLayer());
    const lonely = module.getServiceByClass(LonelyService);

    expect(lonely).toBeDefined();
    expect(lonely?.port).toBeUndefined();
    expect(lonely?.port).not.toBeInstanceOf(DbLike);
    expect(lonely?.port).not.toBeInstanceOf(EventsLike);
  });

  test('should leave a default-valued parameter its default, so nothing that works today changes', () => {
    // This is what makes the chosen semantics — hole becomes `undefined` in place — a patch
    // rather than a break: JS applies a default parameter to `undefined`.
    interface Opts {
      retries: number;
    }

    @Service()
    class WithDefault {
      constructor(public db: DbLike, public opts: Opts = { retries: 3 }) {}
    }

    @Module({ providers: [DbLike, WithDefault] })
    class DefaultModule {}

    const module = new OneBunModule(DefaultModule, makeMockLoggerLayer());
    const withDefault = module.getServiceByClass(WithDefault);

    expect(withDefault?.db).toBeInstanceOf(DbLike);
    expect(withDefault?.opts).toEqual({ retries: 3 });
  });

  test('should key @Optional() by the DECLARED index, even with a hole before it', () => {
    // `isOptionalParam(target, i)` reads a set keyed by the declared parameter index. Against a
    // collapsed array `i` indexed the SHORTENED array, so the decorator was consulted for the
    // wrong parameter — invisible until a hole sat in front of it, as here.
    interface Port {
      go(): void;
    }

    @Service()
    class NeverRegistered {
      readonly which = 'never';
    }

    @Service()
    class OptionalAfterHole {
      constructor(
        public db: DbLike,
        public port?: Port,
        @Optional() public missing?: NeverRegistered,
      ) {}
    }

    @Module({ providers: [DbLike, OptionalAfterHole] })
    class OptionalModule {}

    // `NeverRegistered` is deliberately not provided: without the index lining up, the
    // @Optional() would be read for `port` instead and this would throw.
    const module = new OneBunModule(OptionalModule, makeMockLoggerLayer());
    const service = module.getServiceByClass(OptionalAfterHole);

    expect(service?.db).toBeInstanceOf(DbLike);
    expect(service?.port).toBeUndefined();
    expect(service?.missing).toBeUndefined();
  });
});

describe('every consumer of the paramtypes array, not just services', () => {
  interface Port {
    go(): void;
  }

  /**
   * What each kind's constructor actually received, recorded by the constructor itself.
   *
   * Read from there rather than off the returned value because four of the six kinds hand back a
   * BOUND FUNCTION, not the instance — and the constructor is the only place that can testify to
   * the argument list it was called with, which is the thing under test.
   */
  const received: Record<string, { port: unknown; db: unknown }> = {};

  @Middleware()
  class HoleMiddleware extends BaseMiddleware {
    constructor(public port?: Port, public db?: DbLike) {
      super();
      received.middleware = { port, db };
    }

    async use(_req: OneBunRequest, next: () => Promise<Response>): Promise<Response> {
      return await next();
    }
  }

  @Service()
  class HoleInterceptor {
    constructor(public port?: Port, public db?: DbLike) {
      received.interceptor = { port, db };
    }

    async intercept(_ctx: unknown, next: () => Promise<unknown>): Promise<unknown> {
      return await next();
    }
  }

  @Service()
  class HoleFilter {
    constructor(public port?: Port, public db?: DbLike) {
      received.filter = { port, db };
    }

    catch(): unknown {
      return undefined;
    }
  }

  @Service()
  class HoleGuard {
    constructor(public port?: Port, public db?: DbLike) {
      received.guard = { port, db };
    }

    canActivate(): boolean {
      return true;
    }
  }

  @UseGuards(HoleGuard)
  @CtrlDeco('/hole')
  class HoleController extends Controller {
    constructor(public port?: Port, public db?: DbLike) {
      super();
      received.controller = { port, db };
    }

    @Get('/')
    index(): string {
      return 'ok';
    }
  }

  @Module({
    controllers: [HoleController],
    providers: [DbLike],
  })
  class HoleModule {}

  const buildModule = (): OneBunModule => new OneBunModule(HoleModule, makeMockLoggerLayer());

  /** The one assertion, applied to all six: hole in slot 0, service in slot 1. */
  const expectPositional = (kind: string): void => {
    expect(received[kind], `${kind} constructor never ran`).toBeDefined();
    // Before the fix `port` held the DbLike and `db` was undefined — one slot to the left.
    expect(received[kind].port).toBeUndefined();
    expect(received[kind].db).toBeInstanceOf(DbLike);
  };

  test('middleware keeps its declared positions', () => {
    buildModule().resolveMiddleware([HoleMiddleware]);

    expectPositional('middleware');
  });

  test('interceptor keeps its declared positions', () => {
    buildModule().resolveInterceptors([HoleInterceptor]);

    expectPositional('interceptor');
  });

  test('exception filter keeps its declared positions', () => {
    buildModule().resolveFilters([HoleFilter as never]);

    expectPositional('filter');
  });

  test('guard keeps its declared positions', () => {
    const [guard] = buildModule().resolveGuards([HoleGuard]);

    // Guards are constructed PER REQUEST by design — only the wiring is hoisted — so the
    // constructor runs on the first `canActivate`, not at resolve time.
    guard.canActivate({ type: 'http' } as never);

    expectPositional('guard');
  });

  test('controller keeps its declared positions', () => {
    const module = buildModule();
    Effect.runSync(module.createControllerInstances() as Effect.Effect<unknown, never, never>);

    expectPositional('controller');
  });
});
