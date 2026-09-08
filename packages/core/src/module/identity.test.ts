/**
 * Service identity: what the framework keys by, and where the key stops being enough.
 *
 * Two separate defects, one cause — the class NAME used as an identity:
 *
 * 1. The DI ordering pass keyed `availableServiceClasses`/`createdServices` by name, so
 *    creating one class marked a DIFFERENT class of the same name as created. The deferral
 *    was skipped and boot died with advice that was false. Which `providers` order crashed
 *    was the only difference between a working application and a broken one.
 * 2. An Effect tag is keyed by the class name, so an application holding two instances of one
 *    service class has more instances than keys. Injection is unaffected — it resolves by tag
 *    identity at the module boundary — but asking the APPLICATION for "the" instance has no
 *    correct answer, and returning one made the answer a function of import order.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Effect, type Layer } from 'effect';

import { OneBunApplication } from '../application/application';
import { Module } from '../decorators/decorators';

import {
  registerModule,
  resetRegistrations,
  selectRegistration,
} from './registration';
import {
  BaseService,
  getServiceTag,
  Service,
} from './service';

const appOptions = { port: 0, metrics: { enabled: false }, gracefulShutdown: false } as const;

/**
 * Two DIFFERENT classes that share a name, each with its own consumer. Built in a function so
 * both pairs are genuinely distinct class objects with identical `.name`.
 */
const makePair = (id: string, seen?: string[]) => {
  @Service()
  class Shared extends BaseService {
    readonly id = id;
  }

  @Service()
  class Consumer extends BaseService {
    constructor(public shared: Shared) {
      super();
      seen?.push(shared.id);
    }
  }

  // A tuple, not an object: a shorthand property named after a class is a lint error, and
  // renaming the classes would defeat the point of the fixture.
  return [Shared, Consumer] as const;
};

describe('same-named provider classes', () => {
  test.each([
    ['dependencies declared first', (a: ReturnType<typeof makePair>, b: ReturnType<typeof makePair>) =>
      [a[0], a[1], b[0], b[1]]],
    ['consumers declared first', (a: ReturnType<typeof makePair>, b: ReturnType<typeof makePair>) =>
      [a[1], a[0], b[1], b[0]]],
  ])('boot and resolve correctly with %s', async (_label, order) => {
    // Recorded at construction time: `getService` cannot be the assertion here, because an
    // application holding two Consumers has no unambiguous answer for either — which is the
    // OTHER defect this file covers.
    const seen: string[] = [];
    const a = makePair('A', seen);
    const b = makePair('B', seen);

    @Module({ providers: order(a, b) })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      // Before the fix the second ordering threw `Could not resolve dependency Shared for
      // service Consumer` and advised decorating a class that IS decorated — while the first
      // ordering booted. Same classes, same graph; the array order decided.
      await app.start();

      // Each consumer received ITS OWN dependency, not the other pair's same-named class.
      expect([...seen].sort()).toEqual(['A', 'B']);
    } finally {
      await app.stop();
    }
  });
});

describe('ambiguous untokened accessors', () => {
  const token = (name: string) => `identity-test-${name}`;

  afterEach(() => {
    resetRegistrations();
  });

  const makeRegistrations = () => {
    @Service()
    class Repo extends BaseService {
      marker = 'unset';
    }

    return [
      Repo,
      registerModule(class PrimaryBase {}, { id: 'primary' }, token('primary'), [Repo]),
      registerModule(class ReplicaBase {}, { id: 'replica' }, token('replica'), [Repo]),
    ] as const;
  };

  test('getService(Class) refuses when two registrations reached the tree through DIFFERENT subtrees', async () => {
    const [repo, primary, replica] = makeRegistrations();

    // The case module-level ambiguity detection is silent for: no single module imports both,
    // so every injection in the tree is unambiguous and correct. Only the application-level
    // ask has no answer.
    @Module({ imports: [replica] })
    class FeatureModule {}

    @Module({ imports: [primary, FeatureModule] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      expect(() => app.getService(repo)).toThrow(/instances of Repo/);
      // The token form names one registration and stays answerable.
      expect(app.getService(repo, token('primary'))).toBeInstanceOf(repo);
      expect(app.getService(repo, token('replica'))).toBeInstanceOf(repo);
      expect(app.getService(repo, token('primary'))).not.toBe(app.getService(repo, token('replica')));
    } finally {
      await app.stop();
    }
  });

  test('getLayer() refuses rather than dropping one of the two instances', async () => {
    const [, primary, replica] = makeRegistrations();

    @Module({ imports: [replica] })
    class FeatureModule {}

    @Module({ imports: [primary, FeatureModule] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      // A Context has one slot per key. The layer used to carry whichever instance was
      // merged last, which is a deterministic function of import order and nothing else.
      expect(() => app.getLayer()).toThrow(/one slot per service class/);
    } finally {
      await app.stop();
    }
  });

  test('getLayer([[Class, token]]) names the instance and resolves the refusal', async () => {
    const [repo, primary, replica] = makeRegistrations();

    @Module({ imports: [replica] })
    class FeatureModule {}

    @Module({ imports: [primary, FeatureModule] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      // Distinguish the two instances by something the layer can be read for.
      app.getService(repo, token('primary')).marker = 'primary';
      app.getService(repo, token('replica')).marker = 'replica';

      const read = (layer: Layer.Layer<never, never, unknown>): string => Effect.runSync(
        Effect.provide(
          getServiceTag(repo),
          layer as unknown as Layer.Layer<never, never, never>,
        ) as unknown as Effect.Effect<{ marker: string }, never, never>,
      ).marker;

      // Not "whichever was merged last" — the caller says which, and gets that one.
      expect(read(app.getLayer([[repo, token('replica')]]))).toBe('replica');
      expect(read(app.getLayer([[repo, token('primary')]]))).toBe('primary');
    } finally {
      await app.stop();
    }
  });

  test('a selection that does not name every ambiguous class still refuses, naming what is left', async () => {
    const [repo, primary, replica] = makeRegistrations();
    const other = makePair('other');

    @Module({ providers: [other[0], other[1]], exports: [other[0]] })
    class ModuleA {}

    @Module({ providers: [other[0], other[1]], exports: [other[0]] })
    class ModuleB {}

    @Module({ imports: [replica, ModuleA] })
    class FeatureModule {}

    @Module({ imports: [primary, FeatureModule, ModuleB] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      let message = '';
      try {
        app.getLayer([[repo, token('primary')]]);
      } catch (error) {
        message = (error as Error).message;
      }

      // The one still unresolved is named; the one the caller already answered is not, or the
      // message would send them to fix something they had just fixed.
      expect(message).toContain('Shared');
      expect(message).not.toContain('Repo');
    } finally {
      await app.stop();
    }
  });

  test('selecting an unambiguous class is allowed and pins what was already there', async () => {
    const [shared, consumer] = makePair('only');
    const registration = registerModule(class OnlyBase {}, { id: 'only' }, token('only'), [shared]);

    @Module({ imports: [registration], providers: [consumer] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      expect(app.getLayer([[shared, token('only')]])).toBeDefined();
    } finally {
      await app.stop();
    }
  });

  test('two service classes that share a name are also refused', async () => {
    const a = makePair('A');
    const b = makePair('B');

    @Module({ providers: [a[0], a[1]], exports: [a[0]] })
    class ModuleA {}

    @Module({ providers: [b[0], b[1]], exports: [b[0]] })
    class ModuleB {}

    @Module({ imports: [ModuleA, ModuleB] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      expect(() => app.getService(a[0])).toThrow(/instances of Shared/);
      expect(() => app.getLayer()).toThrow(/one slot per service class/);
    } finally {
      await app.stop();
    }
  });

  test('an ordinary application is unaffected — no false positive', async () => {
    const [shared, consumer] = makePair('only');

    @Module({ providers: [shared, consumer] })
    class AppModule {}

    const app = new OneBunApplication(AppModule, appOptions);

    try {
      await app.start();

      expect(app.getService(shared).id).toBe('only');
      expect(app.getLayer()).toBeDefined();
    } finally {
      await app.stop();
    }
  });
});

describe('unused registration helper', () => {
  afterEach(() => {
    resetRegistrations();
  });

  test('selectRegistration with no configuration falls back to the base module', () => {
    class Base {}

    expect(selectRegistration(Base)).toBe(Base);
  });
});
