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

import { createQueuePatternMatcher } from '@onebun/core';

import { toNatsSubject, widensOnTranslation } from '../src/subject';

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

describe('widensOnTranslation', () => {
  it('answers false for literals and wildcards, which translate one to one', () => {
    expect(widensOnTranslation('orders.created')).toBe(false);
    expect(widensOnTranslation('orders.*')).toBe(false);
    expect(widensOnTranslation('events.#')).toBe(false);
    expect(widensOnTranslation('#')).toBe(false);
  });

  it('answers false for a parameter that is the whole token', () => {
    // `{id}` becomes `*`, and the in-process matcher reads it as one non-empty token too.
    expect(widensOnTranslation('jobs.{id}')).toBe(false);
    expect(widensOnTranslation('orders.{id}.items.{itemId}')).toBe(false);
    expect(widensOnTranslation('orders.*.{id}.#')).toBe(false);
  });

  it('answers true for a parameter that covers only part of a token', () => {
    expect(widensOnTranslation('jobs.v{version}')).toBe(true);
    expect(widensOnTranslation('jobs.{a}-{b}')).toBe(true);
    expect(widensOnTranslation('jobs.{version}v')).toBe(true);
    expect(widensOnTranslation('jobs.{id}.v{version}')).toBe(true);
  });

  it('agrees with the matcher about which subjects the filter lets through', () => {
    // The property the answer stands for: a widening pattern rejects a subject its filter
    // delivers, and a non-widening one accepts every subject of the filter's shape.
    const widening = createQueuePatternMatcher('jobs.v{version}');
    const exact = createQueuePatternMatcher('jobs.{version}');

    expect(toNatsSubject('jobs.v{version}')).toBe('jobs.*');
    expect(widening('jobs.x').matched).toBe(false);
    expect(exact('jobs.x').matched).toBe(true);
  });
});
