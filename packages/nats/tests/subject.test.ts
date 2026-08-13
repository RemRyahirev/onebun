/**
 * Subject Translation Tests
 *
 * `toNatsSubject` is the only OneBun-to-NATS translation in the package, so these
 * are pure: no adapter, no broker, no module mock.
 */

import {
  describe,
  it,
  expect,
} from 'bun:test';

import { toNatsSubject } from '../src/subject';

describe('toNatsSubject', () => {
  it('leaves an exact pattern untouched', () => {
    expect(toNatsSubject('orders.created')).toBe('orders.created');
  });

  it('translates a named parameter to a single-token wildcard', () => {
    expect(toNatsSubject('orders.{id}')).toBe('orders.*');
  });

  it('translates every named parameter in a pattern', () => {
    expect(toNatsSubject('orders.{id}.items.{itemId}')).toBe('orders.*.items.*');
  });

  it('translates a trailing multi-level wildcard to >', () => {
    expect(toNatsSubject('events.#')).toBe('events.>');
  });

  it('leaves a single-token wildcard unchanged', () => {
    expect(toNatsSubject('events.*')).toBe('events.*');
  });

  it('translates a bare # to a bare >', () => {
    expect(toNatsSubject('#')).toBe('>');
  });

  it('widens a token that only partly carries a parameter', () => {
    // NATS has no sub-token wildcard, so the transport widens and the in-process
    // matcher built from the original pattern narrows it back.
    expect(toNatsSubject('orders.v{version}')).toBe('orders.*');
  });

  it('mixes wildcards, parameters and literals in one pattern', () => {
    expect(toNatsSubject('orders.*.{id}.#')).toBe('orders.*.*.>');
  });
});

describe('toNatsSubject: a non-trailing # throws', () => {
  it('rejects a leading #', () => {
    expect(() => toNatsSubject('#.created')).toThrow();
  });

  it('rejects a # in the middle', () => {
    expect(() => toNatsSubject('events.#.created')).toThrow();
  });

  it('rejects a # embedded in a token', () => {
    expect(() => toNatsSubject('events.a#b')).toThrow();
  });

  it('names the offending pattern and the final-token rule', () => {
    let message = '';
    try {
      toNatsSubject('#.created');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('#.created');
    expect(message).toMatch(/final token/i);
  });
});
