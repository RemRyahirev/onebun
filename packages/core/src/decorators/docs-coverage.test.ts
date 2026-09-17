/**
 * Auditing your own constructors: `getConstructorParamTypes` + `isInjectableParamType`.
 *
 * The 0.8.0 note about a parameter that "names nothing injectable" invites exactly one audit,
 * and the obvious spelling of it — `types.filter((t) => t === undefined)` — answers "no holes"
 * for every application ever written, because Bun emits an interface-typed parameter as
 * `Object`. These cases pin what the array really holds and what the container's own predicate
 * says about it.
 *
 * @source docs:api/decorators.md#auditing-constructor-parameters
 */

import {
  describe,
  expect,
  it,
} from 'bun:test';

import { Service } from '../module/service';

import {
  Controller,
  Inject,
  getConstructorParamTypes,
} from './decorators';
import { isInjectableParamType as fromMetadataModule } from './metadata';

import { isInjectableParamType } from './index';

interface SomePort {
  doThing(): void;
}

@Service()
class Resolvable {}

@Service()
class HasAHole {
  // Parameter 0 names no injectable type; parameter 1 does — the configuration the 0.8.0
  // migration note asks consumers to look for.
  constructor(readonly port: SomePort, readonly real: Resolvable) {}
}

@Service()
class AllResolvable {
  constructor(readonly first: Resolvable, readonly second: Resolvable) {}
}

@Controller('/probe')
class TokenInjected {
  constructor(@Inject('PORT_TOKEN') readonly port: SomePort) {}
}

describe('auditing constructor parameters', () => {
  /**
   * @source docs:api/decorators.md#auditing-constructor-parameters
   */
  it('reports an interface-typed parameter as Object, not as undefined', () => {
    const types = getConstructorParamTypes(HasAHole);

    // The reporter's audit — `types.filter((t) => t === undefined)` — finds nothing here, and
    // that is not a bug in the array: `Object` is honestly what TypeScript emitted.
    expect(types?.map((type) => type?.name)).toEqual(['Object', 'Resolvable']);
    expect(types?.filter((type) => type === undefined)).toEqual([]);
  });

  /**
   * @source docs:api/decorators.md#auditing-constructor-parameters
   */
  it('names the hole through the predicate the container itself uses', () => {
    const types = getConstructorParamTypes(HasAHole) ?? [];
    const holes = types.flatMap((type, index) => (isInjectableParamType(type) ? [] : [index]));

    expect(holes).toEqual([0]);
    // And a fully resolvable constructor reports none, so the audit does not cry wolf.
    const clean = getConstructorParamTypes(AllResolvable) ?? [];
    expect(clean.flatMap((type, index) => (isInjectableParamType(type) ? [] : [index]))).toEqual([]);
  });

  /**
   * @source docs:api/decorators.md#auditing-constructor-parameters
   */
  it('answers exactly what the resolver’s own predicate answers', () => {
    // The exported one is the module-internal one the DI path calls — but asserting
    // `toBe(fromMetadataModule)` is wrong HERE: in a full `bun test` run this file's copy of
    // `metadata.ts` and the one another file reached through the package specifier are two
    // instances, so the identity holds in isolation and fails in the suite. The property worth
    // pinning is behavioural anyway — a re-implementation would drift on one of these rows.
    const cases: (Function | undefined)[] = [
      Object, String, Number, Boolean, Function, Array, Symbol, Date, Resolvable, undefined,
    ];

    expect(cases.map((type) => isInjectableParamType(type)))
      .toEqual(cases.map((type) => fromMetadataModule(type)));
  });

  /**
   * @source docs:api/decorators.md#auditing-constructor-parameters
   */
  it('keeps Function and Array injectable, because the resolver fails LOUDLY on them', () => {
    // The hand-written list a consumer would guess — Object/Function/String/Number/Boolean/Array
    // — is wrong in this direction: `Function` and `Array` reach the resolver and raise a
    // DependencyResolutionError at startup. Calling them non-injectable here would turn those
    // startup failures into silent `undefined` injections.
    expect(isInjectableParamType(Object)).toBe(false);
    expect(isInjectableParamType(String)).toBe(false);
    expect(isInjectableParamType(Number)).toBe(false);
    expect(isInjectableParamType(Boolean)).toBe(false);
    expect(isInjectableParamType(Function)).toBe(true);
    expect(isInjectableParamType(Array)).toBe(true);
    expect(isInjectableParamType(Resolvable)).toBe(true);
  });

  /**
   * @source docs:api/decorators.md#auditing-constructor-parameters
   */
  it('treats a missing entry as a hole too', () => {
    expect(isInjectableParamType(undefined)).toBe(false);
  });

  /**
   * @source docs:api/decorators.md#auditing-constructor-parameters
   */
  it('sees through @Inject: a token-named parameter is not a hole', () => {
    // `@Inject(TOKEN)` lives in a side map keyed by parameter index, so the paramtypes array
    // still says `Object` for the interface. The audit would report a false positive if the
    // token map were not consulted — which is why the recipe below pairs the two.
    const types = getConstructorParamTypes(TokenInjected) ?? [];

    expect(types.map((type) => type?.name)).toEqual(['Object']);
    expect(isInjectableParamType(types[0])).toBe(false);
  });
});
