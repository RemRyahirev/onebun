/**
 * What the framework says when a dependency cannot be resolved.
 *
 * The suggestion builder hunted for the missing type by class NAME across a process-wide map of
 * every `@Module()` evaluated anywhere — including packages the application never imported. A
 * same-named class in one of them produced a confident, wrong instruction:
 *
 *   Could not resolve dependency MailerService for service OrderService.
 *     - MailerService is exported from ThirdPartyMailModule. Add ThirdPartyMailModule to imports of AppModule.
 *
 * and that was the ONLY line, because the correct advice — decorate it with `@Service()` and put
 * it in a module's providers — prints only when nothing else was found.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { Global } from '../decorators/decorators';
import {
  BaseService,
  Module,
  OneBunApplication,
  resetRegistrations,
  Service,
} from '../index';


import { registerModule } from './registration';

/** The class the application is actually missing. */
@Service()
class MailerService extends BaseService {
  send(): string {
    return 'ours';
  }
}

/** A different class, same name, in a module this application never imports. */
const foreign = (): Function => {
  @Service()
  class MailerServiceDouble extends BaseService {}

  Object.defineProperty(MailerServiceDouble, 'name', { value: 'MailerService', configurable: true });

  @Module({ providers: [MailerServiceDouble], exports: [MailerServiceDouble] })
  class ThirdPartyMailModule {}

  return ThirdPartyMailModule;
};

const foreignMailModule = foreign();

@Service()
class OrderService extends BaseService {
  constructor(public mailer: MailerService) {
    super();
  }
}

async function bootAndCatch(moduleClass: Function): Promise<string> {
  const app = new OneBunApplication(moduleClass as new () => object, {
    port: 0,
    host: '127.0.0.1',
    metrics: { enabled: false },
    tracing: { enabled: false },
    gracefulShutdown: false,
  });

  try {
    await app.start();
  } catch (error) {
    return (error as Error).message;
  } finally {
    await app.stop().catch(() => undefined);
  }

  return '';
}

describe('unresolved-dependency suggestions', () => {
  afterEach(() => {
    resetRegistrations();
  });

  test('should not name a module that merely has a same-named class', async () => {
    // OrderService needs OUR MailerService, which nobody provides. ThirdPartyMailModule exports
    // a different class that happens to share the name, and this application never imports it.
    @Module({ providers: [OrderService] })
    class AppModule {}

    const message = await bootAndCatch(AppModule);

    expect(message).toContain('Could not resolve dependency MailerService');
    expect(message).not.toContain('ThirdPartyMailModule');
    // The advice that would have fixed it, which the false match used to suppress.
    expect(message).toContain('@Service()');
    expect(message).toContain("listed in a module's providers");

    // Declared and evaluated — the point is that a module in the process is NOT a candidate
    // just because a class inside it shares a name.
    expect((foreignMailModule as Function).name).toBe('ThirdPartyMailModule');
  });

  test('should still name a module that really exports the missing class', async () => {
    @Module({ providers: [MailerService], exports: [MailerService] })
    class MailModule {}

    @Module({ providers: [OrderService] })
    class AppModule {}

    const message = await bootAndCatch(AppModule);

    // The feature has to keep working: same class object, not imported yet.
    expect(message).toContain(`MailerService is exported from ${MailModule.name}`);
    expect(message).toContain('Add MailModule to imports of AppModule');
  });

  test('should point at the token rather than a class name the user cannot write', async () => {
    @Service()
    class ReportRepo extends BaseService {}

    @Module({})
    class ReportingModule {}

    // A named registration mints its own module class — `ReportingModule_analytics` — which is
    // internal. "Add ReportingModule_analytics to imports" used to be the advice, naming
    // something that exists nowhere in the user's source.
    registerModule(ReportingModule, {}, 'analytics', [ReportRepo]);

    @Service()
    class NeedsRepo extends BaseService {
      constructor(public repo: ReportRepo) {
        super();
      }
    }

    @Module({ providers: [NeedsRepo] })
    class AppModule {}

    const message = await bootAndCatch(AppModule);

    expect(message).toContain('named registration of ReportingModule');
    expect(message).toContain('forFeature(<token>)');
    expect(message).not.toContain('ReportingModule_analytics');
  });

  test('should say a global module was never imported rather than blame initialization order', async () => {
    @Service()
    class OrphanService extends BaseService {}

    @Global()
    @Module({ providers: [OrphanService], exports: [OrphanService] })
    class OrphanGlobalModule {}

    // Named in the assertions below: it exists only to be marked @Global() and never imported.
    const orphanModuleName = OrphanGlobalModule.name;

    @Service()
    class NeedsOrphan extends BaseService {
      constructor(public orphan: OrphanService) {
        super();
      }
    }

    @Module({ providers: [NeedsOrphan] })
    class AppModule {}

    const message = await bootAndCatch(AppModule);

    // `@Global()` is process-wide state, so a module can be marked global without this
    // application ever importing it — nothing built it, and "check module initialization order"
    // sends the reader looking in the wrong place.
    expect(message).toContain(`${orphanModuleName}, which is @Global()`);
    expect(message).toContain('nothing in this application imports it');
    expect(message).not.toContain('Check module initialization order');
  });
});
