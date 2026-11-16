/**
 * A decorated class that declares no constructor runs the one it inherits, so DI injects it with
 * that constructor's dependencies (WI-407, a side finding of onebun-FB-33).
 *
 * Through 0.8.3 DI read a class's OWN constructor metadata only, so such a class was built with no
 * arguments and every inherited field was `undefined`. A plain prototype walk over
 * `design:paramtypes` would not have fixed it: `@Inject(Class)`, `@Inject(TOKEN)` and `@Optional()`
 * live in per-class maps, so the child would have got the parent's types but not its explicit
 * classes, token selections or optional marks — a silent `undefined` for the `@Inject` slot, an
 * ambiguous registration for the token slot, and a boot failure for the optional one. All four are
 * therefore taken together, from the nearest ancestor that declares the constructor.
 *
 * A class that declares its own constructor never inherits, decorated or not: its parameters may
 * differ from its parent's, and handing it the parent's array by position is the wrong-object
 * defect of onebun-FB-18.
 */
 
import {
  afterEach,
  describe,
  expect,
  it,
} from 'bun:test';

import {
  Controller,
  Get,
  getConstructorParamTypes,
  getInjectToken,
  Inject,
  isOptionalParam,
  Middleware,
  Module,
  Optional,
  UseGuards,
} from '../decorators/decorators';
import { CircularDependencyError, DependencyResolutionError } from '../errors/dependency-errors';
import { makeRecordingLoggerLayer } from '../testing/test-utils';
import { TestingModule } from '../testing/testing-module';
import { BaseWebSocketGateway } from '../websocket/ws-base-gateway';
import { WebSocketGateway } from '../websocket/ws-decorators';

import { Controller as BaseController } from './controller';
import { BaseMiddleware } from './middleware';
import { OneBunModule } from './module';
import {
  registerModule,
  resetRegistrations,
  selectRegistration,
} from './registration';
import { BaseService, Service } from './service';

interface Notifier {
  send(): string;
}

@Service()
class InhSmsNotifier extends BaseService implements Notifier {
  send(): string {
    return 'sms';
  }
}

@Service()
class InhEmailNotifier extends BaseService implements Notifier {
  send(): string {
    return 'email';
  }
}

@Service()
class InhDepA extends BaseService {}

@Service()
class InhCache extends BaseService {}

/** Not a provider anywhere: constructed by hand where a constructor supplies its own dependency. */
class InhAudit {}

// ChildI: the parent names its implementation with @Inject(Class) on an interface-typed parameter,
// which reflection reports as `Object` — only the explicit entry says which class to inject.
@Service()
class ParentI extends BaseService {
  constructor(@Inject(InhEmailNotifier) readonly notifier: Notifier, readonly depA: InhDepA) {
    super();
  }
}

@Service()
class ChildI extends ParentI {}

// ChildO: the parent marks a dependency @Optional(); the child must not turn it into a required one.
@Service()
class ParentO extends BaseService {
  constructor(readonly depA: InhDepA, @Optional() readonly cache?: InhCache) {
    super();
  }
}

@Service()
class ChildO extends ParentO {}

// Two levels of decorated classes without a constructor: the nearest ancestor that declares one.
@Service()
class RootR extends BaseService {
  constructor(readonly depA: InhDepA) {
    super();
  }
}

@Service()
class MidR extends RootR {}

@Service()
class LeafR extends MidR {}

describe('a decorated class that declares no constructor gets the dependencies of the one it inherits', () => {
  it('ChildI: an @Inject(Class) slot of the parent receives that class in the child', async () => {
    const compiled = await TestingModule.create({
      providers: [InhSmsNotifier, InhEmailNotifier, InhDepA, ParentI, ChildI],
    }).compile();

    try {
      const child = compiled.get(ChildI);

      expect(child.notifier).toBe(compiled.get(InhEmailNotifier));
      expect(child.notifier.send()).toBe('email');
      expect(child.depA).toBe(compiled.get(InhDepA));
    } finally {
      await compiled.close();
    }
  });

  it('ChildO: an @Optional() dependency of the parent stays optional, and the child boots without it', async () => {
    const compiled = await TestingModule.create({ providers: [InhDepA, ParentO, ChildO] }).compile();

    try {
      const child = compiled.get(ChildO);

      expect(child.depA).toBe(compiled.get(InhDepA));
      expect(child.cache).toBeUndefined();
    } finally {
      await compiled.close();
    }
  });

  it('walks past decorated classes that declare no constructor either, to the one that does', async () => {
    const compiled = await TestingModule.create({ providers: [InhDepA, LeafR] }).compile();

    try {
      expect(compiled.get(LeafR).depA).toBe(compiled.get(InhDepA));
    } finally {
      await compiled.close();
    }
  });

  it('reports the inherited metadata through getConstructorParamTypes, isOptionalParam and getInjectToken', () => {
    const token = Symbol('INHERITED_TOKEN');

    @Service()
    class ParentWithToken extends BaseService {
      constructor(@Inject(token) readonly depA: InhDepA) {
        super();
      }
    }

    @Service()
    class ChildWithToken extends ParentWithToken {}

    expect(getConstructorParamTypes(ChildI)).toEqual([InhEmailNotifier, InhDepA]);
    expect(getConstructorParamTypes(LeafR)).toEqual([InhDepA]);
    expect(isOptionalParam(ChildO, 1)).toBe(true);
    expect(isOptionalParam(ChildO, 0)).toBe(false);
    expect(getInjectToken(ChildWithToken, 0)).toBe(token);
  });

  it('a dependency the inherited constructor needs and no module provides now fails the boot, and says why', async () => {
    @Service()
    class InhMissing extends BaseService {}

    @Service()
    class NeedsMissing extends BaseService {
      constructor(readonly missing: InhMissing) {
        super();
      }
    }

    @Service()
    class InheritsNeed extends NeedsMissing {}

    let caught: unknown;
    try {
      const compiled = await TestingModule.create({ providers: [InheritsNeed] }).compile();
      await compiled.close();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DependencyResolutionError);
    const error = caught as DependencyResolutionError;
    expect(error.targetName).toBe('InheritsNeed');
    expect(error.dependencyName).toBe('InhMissing');
    expect(error.message).toContain(
      'InheritsNeed declares no constructor of its own, so it is injected with the parameters of the constructor '
      + 'it inherits from NeedsMissing (InhMissing)',
    );
  });
});

/**
 * Every parameter of an inherited constructor is resolved like any other, so each way a parameter
 * can fail to resolve is a boot failure a subclass that booted with `undefined` fields can now hit.
 * The subclass never names the parameter itself, so each error says where it comes from.
 */
describe('the other boot failures a parameter of an inherited constructor can cause', () => {
  afterEach(() => {
    resetRegistrations();
  });

  /** The error `compile()` rejects with, or `undefined` when it boots. */
  async function compileError(options: Parameters<typeof TestingModule.create>[0]): Promise<Error | undefined> {
    try {
      const compiled = await TestingModule.create(options).compile();
      await compiled.close();
    } catch (error) {
      return error as Error;
    }

    return undefined;
  }

  @Service()
  class InhDb extends BaseService {}

  class InhDbModule {
    static forRoot(as: symbol): Function {
      return registerModule(InhDbModule, {}, as, [InhDb]);
    }

    static forFeature(token: symbol): Function {
      return selectRegistration(InhDbModule, token, [InhDb]);
    }
  }

  it('a dependency that needs the subclass back is a cycle, and the error says the subclass inherits it', async () => {
    @Service()
    class InhBus extends BaseService {}

    @Service()
    class InhRepoBase extends BaseService {
      constructor(readonly bus: InhBus) {
        super();
      }
    }

    // Built with no arguments before 0.9.0, which is all that let this graph boot.
    @Service()
    class InhUserRepo extends InhRepoBase {}

    @Service()
    class InhBusImpl extends InhBus {
      constructor(readonly users: InhUserRepo) {
        super();
      }
    }

    const error = await compileError({ providers: [InhUserRepo, InhBusImpl] });

    expect(error).toBeInstanceOf(CircularDependencyError);
    const cycle = error as CircularDependencyError;
    expect(cycle.chain).toBe('InhUserRepo -> InhBusImpl -> InhUserRepo');
    // InhBusImpl declares its own constructor: nothing to explain there.
    expect(cycle.notes).toEqual([
      'InhUserRepo declares no constructor of its own, so it is injected with the parameters of the constructor it '
      + 'inherits from InhRepoBase (InhBus): that is where it needs InhBus (InhBusImpl). Declare a constructor in '
      + 'InhUserRepo that does not take it to break the cycle.',
    ]);
    expect(cycle.message).toEndWith(`\n  - ${cycle.notes[0]}`);
  });

  it('two selected registrations of the parent\'s parameter type are ambiguous, and the error names the subclass', async () => {
    const first = Symbol('INH_DB_FIRST');
    const second = Symbol('INH_DB_SECOND');

    @Service()
    class InhDbRoot extends BaseService {
      constructor(readonly db: InhDb) {
        super();
      }
    }

    @Service()
    class InhDbChild extends InhDbRoot {}

    @Module({
      imports: [InhDbModule.forFeature(first), InhDbModule.forFeature(second)],
      providers: [InhDbChild],
    })
    class InhAmbiguousModule {}

    const error = await compileError({
      imports: [InhDbModule.forRoot(first), InhDbModule.forRoot(second), InhAmbiguousModule],
    });

    expect(error?.name).toBe('OneBunAmbiguousRegistrationError');
    expect(error?.message).toEndWith(
      'InhDbChild declares no constructor of its own, so it is injected with the parameters of the constructor it '
      + 'inherits from InhDbRoot (InhDb). Name the registration there with @Inject(TOKEN), or declare a constructor '
      + 'in InhDbChild that does not take it.',
    );
  });

  it('a parent\'s @Inject(TOKEN) the subclass\'s module did not select fails, and the error says it is inherited', async () => {
    const first = Symbol('INH_DB_SELECTED');
    const second = Symbol('INH_DB_UNSELECTED');

    @Service()
    class InhTokenRoot extends BaseService {
      constructor(@Inject(second) readonly db: InhDb) {
        super();
      }
    }

    @Service()
    class InhTokenChild extends InhTokenRoot {}

    @Module({ imports: [InhDbModule.forFeature(first)], providers: [InhTokenChild] })
    class InhUnselectedModule {}

    const error = await compileError({
      imports: [InhDbModule.forRoot(first), InhDbModule.forRoot(second), InhUnselectedModule],
    });

    expect(error?.name).toBe('OneBunUnselectedRegistrationError');
    expect(error?.message).toContain('that InhTokenChild asks for');
    expect(error?.message).toEndWith(
      'InhTokenChild declares no constructor of its own, so it is injected with the parameters of the constructor it '
      + 'inherits from InhTokenRoot (InhDb), and that is where the token comes from. Select it in this module, or '
      + 'declare a constructor in InhTokenChild that does not take it.',
    );
  });

  it('an @Optional() parameter typed as its own class does not wait for a subclass that injects it back', async () => {
    @Service()
    class InhNode extends BaseService {
      constructor(@Optional() readonly next?: InhNode) {
        super();
      }
    }

    // Inherits the @Optional() parameter. InhNode used to wait for ITSELF, which only this class,
    // built with no arguments before 0.9.0, resolved; now it waits for InhNode as well.
    @Service()
    class InhLeafNode extends InhNode {}

    for (const providers of [[InhNode, InhLeafNode], [InhLeafNode, InhNode]]) {
      const compiled = await TestingModule.create({ providers }).captureLogs().compile();

      try {
        expect(compiled.get(InhNode).next).toBeUndefined();
        expect(compiled.get(InhLeafNode).next).toBe(compiled.get(InhNode));
        // Listing InhLeafNode first cannot help, so the warning must not suggest it.
        expect(compiled.logs.filter((record) => record.level === 'warn').map((record) => record.message)).toEqual([
          'InhNode gets undefined for its @Optional() parameter #0 (InhNode): InhLeafNode, which extends it, injects '
          + 'InhNode in turn, so InhNode is built first. Declare a constructor in InhLeafNode that does not take '
          + 'InhNode to have it injected here.',
        ]);
      } finally {
        await compiled.close();
      }
    }
  });

  it('a parameter typed as its own class still waits for a subclass that declares its own constructor', async () => {
    @Service()
    class InhOwnNode extends BaseService {
      constructor(@Optional() readonly next?: InhOwnNode) {
        super();
      }
    }

    // Declares its constructor, so it inherits nothing and is built without InhOwnNode: the
    // self-typed parameter waits for it, and receives it, as through 0.8.x.
    @Service()
    class InhOwnLeaf extends InhOwnNode {
      // eslint-disable-next-line @typescript-eslint/no-useless-constructor
      constructor() {
        super();
      }
    }

    // Inherits the parameter, so it waits for InhOwnNode: it must not stop InhOwnNode waiting.
    @Service()
    class InhOwnSibling extends InhOwnNode {}

    const orders = [
      [InhOwnNode, InhOwnLeaf],
      [InhOwnLeaf, InhOwnNode],
      [InhOwnNode, InhOwnSibling, InhOwnLeaf],
    ];
    for (const providers of orders) {
      const compiled = await TestingModule.create({ providers }).captureLogs().compile();

      try {
        expect(compiled.get(InhOwnNode).next).toBe(compiled.get(InhOwnLeaf));
        expect(compiled.get(InhOwnLeaf).next).toBeUndefined();
        if (providers.includes(InhOwnSibling)) {
          expect(compiled.get(InhOwnSibling).next).toBe(compiled.get(InhOwnNode));
        }
        expect(compiled.logs.filter((record) => record.level === 'warn')).toEqual([]);
      } finally {
        await compiled.close();
      }
    }
  });
});

describe('ChildT: an @Inject(TOKEN) selection of the parent is inherited with the parameter', () => {
  afterEach(() => {
    resetRegistrations();
  });

  it('receives the token-selected registration, not an ambiguity error', async () => {
    const mainDb = Symbol('INH_MAIN_DB');
    const analyticsDb = Symbol('INH_ANALYTICS_DB');

    interface StorageOptions {
      url: string;
      as?: symbol;
    }

    @Service()
    class InhStorageService extends BaseService {
      get url(): string {
        return this.registrationOptions<StorageOptions>()?.url ?? '(unconfigured)';
      }
    }

    class InhStorageModule {
      static forRoot(options: StorageOptions): Function {
        return registerModule(InhStorageModule, options, options.as, [InhStorageService]);
      }

      static forFeature(token: symbol): Function {
        return selectRegistration(InhStorageModule, token, [InhStorageService]);
      }
    }

    @Service()
    class ParentT extends BaseService {
      constructor(@Inject(analyticsDb) readonly storage: InhStorageService) {
        super();
      }
    }

    @Service()
    class ChildT extends ParentT {}

    @Module({
      imports: [InhStorageModule.forFeature(mainDb), InhStorageModule.forFeature(analyticsDb)],
      providers: [ParentT, ChildT],
      exports: [ParentT, ChildT],
    })
    class InhReportModule {}

    const compiled = await TestingModule.create({
      imports: [
        InhStorageModule.forRoot({ url: 'main://db', as: mainDb }),
        InhStorageModule.forRoot({ url: 'analytics://db', as: analyticsDb }),
        InhReportModule,
      ],
    }).compile();

    try {
      // Without the token the parameter matches both registrations of one module, which is an error.
      expect(compiled.get(ChildT).storage.url).toBe('analytics://db');
      expect(compiled.get(ParentT).storage.url).toBe('analytics://db');
    } finally {
      await compiled.close();
    }
  });
});

describe('a class that declares its own constructor never inherits', () => {
  @Service()
  class InhDepB extends BaseService {}

  @Service()
  class ParentB extends BaseService {
    constructor(readonly depB: InhDepB) {
      super();
    }
  }

  it('decorated, with a constructor() that takes nothing: built with no arguments and no parent dependency required', async () => {
    @Service()
    class SelfSupplied extends ParentB {
      constructor() {
        super(new InhDepB());
      }
    }

    const compiled = await TestingModule.create({ providers: [SelfSupplied] }).compile();

    try {
      expect(getConstructorParamTypes(SelfSupplied)).toBeUndefined();
      expect(compiled.get(SelfSupplied).depB).toBeInstanceOf(InhDepB);
    } finally {
      await compiled.close();
    }
  });

  it('decorated, with parameters of its own: gets its own types only', async () => {
    @Service()
    class InhAuditService extends BaseService {}

    @Service()
    class OwnParams extends ParentB {
      constructor(readonly audit: InhAuditService) {
        super(new InhDepB());
      }
    }

    const compiled = await TestingModule.create({ providers: [InhAuditService, OwnParams] }).compile();

    try {
      expect(getConstructorParamTypes(OwnParams)).toEqual([InhAuditService]);
      expect(compiled.get(OwnParams).audit).toBe(compiled.get(InhAuditService));
    } finally {
      await compiled.close();
    }
  });

  it('a decorated class below one that declares constructor() inherits that empty constructor, not the one above it', async () => {
    @Service()
    class EmptyMid extends ParentB {
      constructor() {
        super(new InhDepB());
      }
    }

    @Service()
    class BelowEmpty extends EmptyMid {}

    const recorder = makeRecordingLoggerLayer();

    @Module({ providers: [BelowEmpty] })
    class BelowEmptyModule {}

    const module = new OneBunModule(BelowEmptyModule, recorder.layer);

    expect(getConstructorParamTypes(BelowEmpty)).toBeUndefined();
    expect(module.getServiceByClass(BelowEmpty)!.depB).toBeInstanceOf(InhDepB);
    expect(recorder.messages('warn')).toEqual([]);
  });

  /**
   * Undecorated, so nothing tells a constructor it declares from none at all — neither shape
   * inherits. The one with its own `(audit)` constructor is the onebun-FB-33 review fixture: under a
   * prototype walk it received the base's TokenStore in its `audit` slot and the route answered 200.
   */
  it('undecorated guards: one with its own constructor gets none of the base\'s types, one without is not injected', async () => {
    @Service()
    class InhTokenStore extends BaseService {
      check(): boolean {
        return true;
      }
    }

    @Service()
    class InhBaseAuthGuard {
      constructor(protected readonly tokens: InhTokenStore, protected readonly audit?: unknown) {}

      canActivate(): boolean {
        return this.tokens instanceof InhTokenStore && this.tokens.check();
      }
    }

    const received: string[] = [];

    class InhAuditingGuard extends InhBaseAuthGuard {
      constructor(audit: InhAudit) {
        super(new InhTokenStore(), audit);
        received.push(audit === undefined ? 'undefined' : (audit as object).constructor.name);
      }
    }

    class InhUndecoratedGuard extends InhBaseAuthGuard {}

    @Service()
    class InhDecoratedGuard extends InhBaseAuthGuard {}

    @Controller('/inh-guards')
    class InhGuardedController extends BaseController {
      @Get('/auditing')
      @UseGuards(InhAuditingGuard)
      auditing(): { ok: boolean } {
        return { ok: true };
      }

      @Get('/undecorated')
      @UseGuards(InhUndecoratedGuard)
      undecorated(): { ok: boolean } {
        return { ok: true };
      }

      @Get('/decorated')
      @UseGuards(InhDecoratedGuard)
      decorated(): { ok: boolean } {
        return { ok: true };
      }
    }

    const compiled = await TestingModule.create({
      controllers: [InhGuardedController],
      providers: [InhTokenStore],
    }).captureLogs().compile();

    try {
      expect((await compiled.inject('GET', '/inh-guards/auditing')).status).toBe(200);
      expect(received).toEqual(['undefined']);
      expect(getConstructorParamTypes(InhAuditingGuard)).toBeUndefined();

      expect((await compiled.inject('GET', '/inh-guards/undecorated')).status).toBe(403);
      expect(getConstructorParamTypes(InhUndecoratedGuard)).toBeUndefined();

      // The same class with a decorator inherits the base's constructor dependencies.
      expect((await compiled.inject('GET', '/inh-guards/decorated')).status).toBe(200);
      expect(getConstructorParamTypes(InhDecoratedGuard)).toEqual([InhTokenStore, Object]);

      const warnings = compiled.logs.filter((record) => record.level === 'warn').map((record) => record.message);
      expect(warnings.filter((message) => message.startsWith('InhAuditingGuard declares a constructor with parameters')))
        .toHaveLength(1);
      expect(warnings.filter((message) => message.startsWith('InhUndecoratedGuard declares no constructor of its own')))
        .toHaveLength(1);
      expect(warnings.filter((message) => message.startsWith('InhDecoratedGuard'))).toEqual([]);
    } finally {
      await compiled.close();
    }
  });
});

describe('the @Controller wrapper', () => {
  @Controller('/inh-parent')
  class InhParentController extends BaseController {
    constructor(
      @Inject(InhEmailNotifier) readonly notifier: Notifier,
      readonly depA: InhDepA,
      @Optional() readonly cache?: InhCache,
    ) {
      super();
    }

    @Get('/')
    describe(): { notifier: string | null; depA: boolean; cache: boolean } {
      return {
        notifier: this.notifier?.send() ?? null,
        depA: this.depA instanceof InhDepA,
        cache: this.cache !== undefined,
      };
    }
  }

  it('a controller that declares no constructor inherits all four sources through the wrapper', async () => {
    @Controller('/inh-child')
    class InhChildController extends InhParentController {
      @Get('/')
      describeChild(): ReturnType<InhParentController['describe']> {
        return this.describe();
      }
    }

    const compiled = await TestingModule.create({
      controllers: [InhParentController, InhChildController],
      providers: [InhSmsNotifier, InhEmailNotifier, InhDepA],
    }).captureLogs().compile();

    try {
      const response = await compiled.inject('GET', '/inh-child');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        result: { notifier: 'email', depA: true, cache: false },
      });
      expect(getConstructorParamTypes(InhChildController)).toEqual([InhEmailNotifier, InhDepA, InhCache]);
      expect(isOptionalParam(InhChildController, 2)).toBe(true);
      expect(compiled.logs.filter((record) => record.level === 'warn')).toEqual([]);
    } finally {
      await compiled.close();
    }
  });

  it('a controller that declares its own constructor gets its own parameters only', async () => {
    @Service()
    class InhOwnDep extends BaseService {}

    @Controller('/inh-own')
    class InhOwnController extends InhParentController {
      constructor(readonly own: InhOwnDep) {
        super(new InhEmailNotifier(), new InhDepA());
      }

      @Get('/')
      ownDep(): { own: boolean } {
        return { own: this.own instanceof InhOwnDep };
      }
    }

    @Controller('/inh-zero')
    class InhZeroController extends InhParentController {
      constructor() {
        super(new InhSmsNotifier(), new InhDepA());
      }

      @Get('/')
      zero(): ReturnType<InhParentController['describe']> {
        return this.describe();
      }
    }

    // Neither the parent's notifier nor its InhDepA is provided: nothing may ask for them.
    const compiled = await TestingModule.create({
      controllers: [InhOwnController, InhZeroController],
      providers: [InhOwnDep],
    }).compile();

    try {
      expect(await (await compiled.inject('GET', '/inh-own')).json()).toEqual({ success: true, result: { own: true } });
      expect(await (await compiled.inject('GET', '/inh-zero')).json()).toEqual({
        success: true,
        result: { notifier: 'sms', depA: true, cache: false },
      });
      expect(getConstructorParamTypes(InhOwnController)).toEqual([InhOwnDep]);
      expect(getConstructorParamTypes(InhZeroController)).toBeUndefined();
    } finally {
      await compiled.close();
    }
  });
});

describe('middleware and gateways', () => {
  it('a @Middleware() subclass without a constructor inherits; an undecorated one does not', () => {
    const received: string[] = [];

    @Middleware()
    class InhParentMiddleware extends BaseMiddleware {
      constructor(readonly depA: InhDepA) {
        super();
        received.push(`${new.target.name}: ${depA instanceof InhDepA ? 'InhDepA' : String(depA)}`);
      }

      async use(_req: unknown, next: () => Promise<Response>): Promise<Response> {
        return await next();
      }
    }

    @Middleware()
    class InhChildMiddleware extends InhParentMiddleware {}

    class InhUndecoratedMiddleware extends InhParentMiddleware {}

    const recorder = makeRecordingLoggerLayer();

    @Module({ providers: [InhDepA] })
    class InhMiddlewareModule {}

    const module = new OneBunModule(InhMiddlewareModule, recorder.layer);
    module.resolveMiddleware([InhChildMiddleware, InhUndecoratedMiddleware]);

    expect(received).toEqual(['InhChildMiddleware: InhDepA', 'InhUndecoratedMiddleware: undefined']);
    expect(getConstructorParamTypes(InhChildMiddleware)).toEqual([InhDepA]);
    expect(getConstructorParamTypes(InhUndecoratedMiddleware)).toBeUndefined();
    expect(recorder.messages('warn').filter((message) => message.startsWith('InhChildMiddleware'))).toEqual([]);
    expect(recorder.messages('warn').filter((message) => message.startsWith('InhUndecoratedMiddleware declares no constructor')))
      .toHaveLength(1);
  });

  it('a @WebSocketGateway() subclass without a constructor inherits', () => {
    @WebSocketGateway({ path: '/inh-parent' })
    class InhParentGateway extends BaseWebSocketGateway {
      constructor(readonly depA: InhDepA) {
        super();
      }
    }

    @WebSocketGateway({ path: '/inh-child' })
    class InhChildGateway extends InhParentGateway {}

    expect(getConstructorParamTypes(InhChildGateway)).toEqual([InhDepA]);
  });
});

describe('a chain that passes through an undecorated class', () => {
  @Service()
  class InhDepC extends BaseService {}

  @Service()
  class RootC extends BaseService {
    constructor(readonly depC: InhDepC) {
      super();
    }
  }

  it('does not inherit past it, and startup names the class that stops it', () => {
    // Undecorated, so a constructor it declared would record nothing: DI cannot tell whether the
    // class below runs RootC's constructor or one of its own.
    class UndecoratedMid extends RootC {}

    @Service()
    class LeafBelowUndecorated extends UndecoratedMid {}

    const recorder = makeRecordingLoggerLayer();

    @Module({ providers: [InhDepC, LeafBelowUndecorated] })
    class UndecoratedChainModule {}

    const module = new OneBunModule(UndecoratedChainModule, recorder.layer);
    const warnings = recorder.messages('warn')
      .filter((message) => message.startsWith('LeafBelowUndecorated declares no constructor of its own'));

    expect(getConstructorParamTypes(LeafBelowUndecorated)).toBeUndefined();
    expect(module.getServiceByClass(LeafBelowUndecorated)!.depC).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('UndecoratedMid, which it extends, carries no decorator');
    expect(warnings[0]).toContain('If LeafBelowUndecorated runs the constructor of RootC, which takes (InhDepC)');
    expect(warnings[0]).toContain('Give UndecoratedMid a decorator (@Service()) if it declares no constructor');
  });

  it('names the class whose constructor it runs when that class declares parameters but carries no decorator', () => {
    class UndecoratedWithParams extends RootC {
      // Not useless: it is the shape under test — parameters of its own, and no decorator.
      // eslint-disable-next-line @typescript-eslint/no-useless-constructor
      constructor(depC: InhDepC) {
        super(depC);
      }
    }

    @Service()
    class LeafBelowParams extends UndecoratedWithParams {}

    const recorder = makeRecordingLoggerLayer();

    @Module({ providers: [InhDepC, LeafBelowParams] })
    class ParamsChainModule {}

    const module = new OneBunModule(ParamsChainModule, recorder.layer);
    const warnings = recorder.messages('warn').filter((message) => message.startsWith('LeafBelowParams'));

    expect(module.getServiceByClass(LeafBelowParams)!.depC).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith(
      'LeafBelowParams declares no constructor of its own and runs the one it inherits from UndecoratedWithParams, '
      + 'which declares parameters',
    );
    expect(warnings[0]).toEndWith('Add @Service() to UndecoratedWithParams to have its constructor injected.');
  });
});
