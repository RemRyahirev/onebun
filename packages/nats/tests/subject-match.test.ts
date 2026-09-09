/**
 * Union coverage over NATS subject patterns.
 *
 * The narrowing guard asks "would applying my declaration stop the server storing something it
 * stores today". Asked of each declared subject in turn, that question has a wrong answer whenever
 * the declaration covers a server subject only JOINTLY: `['orders.*', 'orders.*.>']` covers
 * `orders.>` exactly, and neither half covers it alone. The guard refused to boot and named a
 * subject that would in fact still be stored.
 *
 * These tests are about the set question. The pairwise predicates are covered in
 * jetstream.adapter.test.ts, through the adapter's own delegating methods.
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import {
  natsSubjectCovers,
  natsSubjectsOverlap,
  unionCoversSubject,
} from '../src/subject-match';

describe('unionCoversSubject', () => {
  it('accepts a declaration that covers a subject only jointly', () => {
    // The defect. Split by depth, the two halves partition `orders.>` exactly.
    expect(natsSubjectCovers('orders.*', 'orders.>')).toBe(false);
    expect(natsSubjectCovers('orders.*.>', 'orders.>')).toBe(false);

    expect(unionCoversSubject(['orders.*', 'orders.*.>'], 'orders.>')).toBe(true);
  });

  it('still refuses a genuine narrowing', () => {
    // `orders.a.b` is stored today and would stop being stored — the case the guard exists for.
    expect(unionCoversSubject(['orders.*'], 'orders.>')).toBe(false);
    // And the literal case: everything except `orders.created` would be dropped.
    expect(unionCoversSubject(['orders.created'], 'orders.>')).toBe(false);
    // A union that still leaves a hole at depth 3.
    expect(unionCoversSubject(['orders.*', 'orders.*.created'], 'orders.>')).toBe(false);
  });

  it('agrees with the single-subject answer wherever one subject covers', () => {
    const covering: Array<[string[], string]> = [
      [['test.>'], 'test.topic'],
      [['agent.events.>'], 'agent.events.done'],
      [['orders.*'], 'orders.*'],
      [['*'], 'events'],
      [['a.x'], 'a.x'],
    ];

    for (const [declared, existing] of covering) {
      expect(unionCoversSubject(declared, existing)).toBe(true);
      expect(declared.some(pattern => natsSubjectCovers(pattern, existing))).toBe(true);
    }
  });

  it('refuses where no single subject covers and the union leaves a hole', () => {
    expect(unionCoversSubject(['a.x'], 'a.y')).toBe(false);
    expect(unionCoversSubject(['a.x', 'a.z'], 'a.*')).toBe(false);
    expect(unionCoversSubject([], 'a.x')).toBe(false);
  });

  it('covers a wildcard position that the declarations partition by literal', () => {
    // Every token at position 1 is named, but nothing covers `a.*` on its own... and nothing
    // covers it jointly either: `a.c` is stored under `a.*` and named by neither.
    expect(unionCoversSubject(['a.x', 'a.y'], 'a.*')).toBe(false);

    // Adding a catch-all for that position closes it.
    expect(unionCoversSubject(['a.x', 'a.y', 'a.*'], 'a.*')).toBe(true);
  });

  it('decides the unbounded tail from a bounded enumeration', () => {
    // `>` at depth 2 needs every depth from 2 upwards. Only a `>`-terminated declaration can
    // reach past the deepest literal declaration, which is what bounds the search.
    expect(unionCoversSubject(['a.*', 'a.*.*'], 'a.>')).toBe(false);
    expect(unionCoversSubject(['a.*', 'a.*.>'], 'a.>')).toBe(true);
    expect(unionCoversSubject(['a.*', 'a.*.*', 'a.*.*.>'], 'a.>')).toBe(true);
  });

  it('is not fooled by a declaration that only overlaps', () => {
    // Overlap is not coverage, and the union of overlaps is still not coverage.
    expect(natsSubjectsOverlap('a.*.c', 'a.b.>')).toBe(true);
    expect(unionCoversSubject(['a.*.c'], 'a.b.>')).toBe(false);
  });

  it('answers conservatively rather than slowly when the enumeration would explode', () => {
    // `a.*` and `a.*.>` cover `a.>` between them, so the honest answer here is `true`. The decoys
    // add nothing to the coverage and everything to the search: 21 named literals at each of
    // three free positions is more witnesses than the cap allows. Crossing it returns `false` —
    // refusing a declaration that was in fact safe, rather than admitting one that narrows. The
    // guard exists to prevent silent message loss, so it errs where that cannot happen.
    const decoys = Array.from({ length: 20 }, (_, i) => `a.p${i}.q${i}.r${i}`);

    expect(unionCoversSubject(['a.*', 'a.*.>'], 'a.>')).toBe(true);

    const startedAt = Date.now();
    const answer = unionCoversSubject(['a.*', 'a.*.>', ...decoys], 'a.>');

    expect(answer).toBe(false);
    // And it bails instead of enumerating: this must not become a boot-time hang.
    expect(Date.now() - startedAt).toBeLessThan(200);
  });

  it('treats sub-token wildcards and unbalanced braces as literals', () => {
    // Exactly as nats-server does: no substring wildcarding, ever.
    expect(unionCoversSubject(['orders.v*'], 'orders.v1')).toBe(false);
    expect(unionCoversSubject(['orders.v*'], 'orders.v*')).toBe(true);
    expect(unionCoversSubject(['orders.{id'], 'orders.{id')).toBe(true);
  });
});
