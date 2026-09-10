/**
 * Two unnamed `forRoot()` calls that disagree.
 *
 * An unnamed registration keeps the base module itself as its identity, so two applications in
 * one process cannot each hold their own answer — they are literally pointing at the same class.
 * What they CAN have is the disagreement reported instead of silently resolved by whichever call
 * the module loader evaluated last.
 *
 * The check is at boot, gated on reachability from the booting root: the defect is "an
 * application was wired on an answer it did not declare", and that is what boot-with-reachability
 * describes. A throw at the second `forRoot()` would also fail a process that imports two module
 * graphs and boots neither — the ordinary shape of a test suite.
 */

import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';

import { Module } from '../decorators/decorators';

import {
  assertRegistrationsConfigured,
  registerModule,
  resetRegistrations,
} from './registration';

/** Stands in for a dynamic module's `forRoot()`, which is all `registerModule` ever sees. */
function forRoot(base: Function, options: unknown, isGlobal?: boolean): Function {
  return registerModule(base, options, undefined, [], isGlobal !== false);
}

describe('conflicting unnamed registrations', () => {
  afterEach(() => {
    resetRegistrations();
  });

  test('should refuse two calls that disagree about ambient visibility', () => {
    @Module({})
    class ConfigModule {}

    @Module({ imports: [ConfigModule] })
    class AppModule {}

    forRoot(ConfigModule, { host: 'a' }, false);
    forRoot(ConfigModule, { host: 'a' });

    expect(() => assertRegistrationsConfigured(AppModule))
      .toThrow(/called more than once in this process, with different ambient visibility/);
  });

  test('should name both call sites and the token remedy', () => {
    @Module({})
    class ConfigModule {}

    @Module({ imports: [ConfigModule] })
    class AppModule {}

    forRoot(ConfigModule, { host: 'a' }, false);
    forRoot(ConfigModule, { host: 'a' });

    let message = '';
    try {
      assertRegistrationsConfigured(AppModule);
    } catch (error) {
      message = (error as Error).message;
      expect((error as Error).name).toBe('OneBunConflictingRegistrationError');
    }

    // Both calls, each with its own address — the whole point is that the user can find them.
    const sites = message.match(/registration-conflict\.test\.ts:\d+:\d+/g) ?? [];
    expect(sites.length).toBe(2);
    expect(sites[0]).not.toBe(sites[1]);

    expect(message).toContain('isGlobal: false');
    expect(message).toContain('isGlobal: true');
    expect(message).toContain('as: TOKEN');
    expect(message).toContain('ConfigModule.forFeature(TOKEN)');
  });

  test('should refuse two calls that agree on visibility but configure different targets', () => {
    @Module({})
    class DbModule {}

    @Module({ imports: [DbModule] })
    class AppModule {}

    forRoot(DbModule, { connection: { url: './db_a.sqlite' } });
    forRoot(DbModule, { connection: { url: './db_b.sqlite' } });

    let message = '';
    try {
      assertRegistrationsConfigured(AppModule);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('a different configuration');
    // The difference is printed, not just asserted to exist.
    expect(message).toContain('db_a.sqlite');
    expect(message).toContain('db_b.sqlite');
  });

  test('should say nothing when two calls configure the same thing', () => {
    @Module({})
    class ConfigModule {}

    @Module({ imports: [ConfigModule] })
    class AppModule {}

    // A library re-exporting a configured module, or a test re-registering one, is normal.
    forRoot(ConfigModule, { host: 'a', port: 5432 });
    forRoot(ConfigModule, { port: 5432, host: 'a' });

    expect(() => assertRegistrationsConfigured(AppModule)).not.toThrow();
  });

  test('should ignore a conflict over a module this application never imports', () => {
    @Module({})
    class ConfigModule {}

    @Module({})
    class AppModule {}

    forRoot(ConfigModule, { host: 'a' }, false);
    forRoot(ConfigModule, { host: 'b' });

    // The reachability gate: another application's disagreement is not this one's failure.
    expect(() => assertRegistrationsConfigured(AppModule)).not.toThrow();
  });

  test('should reach a conflicting module through a nested import', () => {
    @Module({})
    class ConfigModule {}

    @Module({ imports: [ConfigModule] })
    class FeatureModule {}

    @Module({ imports: [FeatureModule] })
    class AppModule {}

    forRoot(ConfigModule, { host: 'a' }, false);
    forRoot(ConfigModule, { host: 'a' });

    expect(() => assertRegistrationsConfigured(AppModule)).toThrow(/ambient visibility/);
  });

  test('should skip the check entirely when there is no root to be reachable from', () => {
    @Module({})
    class ConfigModule {}

    forRoot(ConfigModule, { host: 'a' }, false);
    forRoot(ConfigModule, { host: 'b' });

    // Without a root the gate has nothing to gate on. Widening to the whole process here would
    // reintroduce exactly the over-eager failure the boot placement exists to avoid.
    expect(() => assertRegistrationsConfigured()).not.toThrow();
  });

  test('should not invent a visibility conflict out of a caller that never reported one', () => {
    @Module({})
    class ConfigModule {}

    @Module({ imports: [ConfigModule] })
    class AppModule {}

    // A module whose forRoot() passes no globality: silence is not a claim of agreement, but it
    // is not a claim of disagreement either.
    registerModule(ConfigModule, { host: 'a' }, undefined, []);
    registerModule(ConfigModule, { host: 'a' }, undefined, []);

    expect(() => assertRegistrationsConfigured(AppModule)).not.toThrow();
  });

  test('should not count a named registration as a competing unnamed one', () => {
    @Module({})
    class ConfigModule {}

    const named = registerModule(ConfigModule, { host: 'b' }, 'replica', []);

    @Module({ imports: [ConfigModule, named] })
    class AppModule {}

    forRoot(ConfigModule, { host: 'a' });

    // One unnamed call and one named call is the ordinary two-registration shape, not a
    // disagreement. If a named call ever started landing in the unnamed history, this is where
    // it would show up — as a boot failure for everyone using `as:`, which is the remedy the
    // conflict error itself recommends.
    expect(() => assertRegistrationsConfigured(AppModule)).not.toThrow();
  });

  test('should leave named registrations alone — they already have their own identity', () => {
    @Module({})
    class ConfigModule {}

    const first = registerModule(ConfigModule, { host: 'a' }, 'primary', []);
    const second = registerModule(ConfigModule, { host: 'b' }, 'replica', []);

    @Module({ imports: [first, second] })
    class AppModule {}

    expect(() => assertRegistrationsConfigured(AppModule)).not.toThrow();
  });
});
