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

import {
  toNatsSubject,
  validateNatsSubscriptionPattern,
  widensOnTranslation,
} from '../src/subject';

/** A parameter name holding whitespace, which never reaches the wire. */
const SPACED_NAME = 'a b';

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

describe('toNatsSubject: native NATS wildcards', () => {
  it('passes a trailing > and a whole-token * through as the same wildcards', () => {
    expect(toNatsSubject('events.>')).toBe('events.>');
    expect(toNatsSubject('>')).toBe('>');
    expect(toNatsSubject('orders.*.>')).toBe('orders.*.>');
  });

  it('gives a native wildcard the subject its framework spelling gets', () => {
    expect(toNatsSubject('events.>')).toBe(toNatsSubject('events.#'));
    expect(toNatsSubject('orders.*')).toBe(toNatsSubject('orders.{id}'));
  });

  it('never widens a native wildcard', () => {
    expect(widensOnTranslation('events.>')).toBe(false);
    expect(widensOnTranslation('>')).toBe(false);
  });

  it('agrees with the matcher on every subject a trailing > filter delivers', () => {
    const matcher = createQueuePatternMatcher('events.>');

    for (const subject of ['events.a', 'events.a.b', 'events.a.b.c']) {
      expect(matcher(subject).matched).toBe(true);
    }
    expect(matcher('events').matched).toBe(false);
    expect(matcher('other.a').matched).toBe(false);
  });
});

describe('validateNatsSubscriptionPattern', () => {
  it('accepts every pattern a NATS filter can express', () => {
    for (const pattern of [
      'orders.created',
      'orders.*',
      '*',
      'orders.*.status',
      'events.>',
      '>',
      'events.#',
      'orders.{id}',
      'orders.v{version}',
      'orders.{a}-{b}',
      'tenants.{tenant}.>',
      '*.*.>',
      // Whitespace inside a parameter is part of its name and never reaches the wire.
      'orders.{a b}',
      'orders.v{a b}',
      // `{}` is a parameter with an empty name, not an empty token.
      'orders.{}',
      // A `>` inside a parameter is part of its name, not a non-final wildcard.
      'orders.{>}.created',
    ]) {
      expect(() => validateNatsSubscriptionPattern(pattern)).not.toThrow();
    }
  });

  it('accepts a wildcard glued into a token, which the server serves as its literal subject', () => {
    for (const pattern of ['orders.v*', 'orders.a*b', 'orders.*a', 'orders.**', 'events.new>', 'events.a>b', 'events.>>', 'orders.{id}>', 'orders.{id}*']) {
      expect(() => validateNatsSubscriptionPattern(pattern)).not.toThrow();
    }
    // The filter keeps the token as written — literal on the server — unless a parameter widens it.
    expect(toNatsSubject('orders.v*')).toBe('orders.v*');
    expect(toNatsSubject('events.new>')).toBe('events.new>');
    expect(toNatsSubject('orders.{id}>')).toBe('orders.*');
    expect(widensOnTranslation('orders.v*')).toBe(false);
    expect(widensOnTranslation('orders.{id}>')).toBe(true);
  });

  it('accepts a glued wildcard whose literal subject the matcher matches, so the handler runs', () => {
    // The server delivers exactly the literal subject the pattern spells; the matcher's exact-match
    // path, and for `*` its sub-token wildcard, both accept it.
    for (const pattern of ['orders.v*', 'orders.a*b', 'orders.*a', 'orders.**', 'events.new>', 'events.a>b', 'events.>>']) {
      expect(createQueuePatternMatcher(pattern)(pattern)).toEqual({ matched: true, params: {} });
    }
    expect(createQueuePatternMatcher('orders.{id}>')('orders.1>')).toEqual({ matched: true, params: { id: '1' } });
  });

  const refused: Array<{ pattern: string; says: RegExp }> = [
    { pattern: 'events.>.created', says: /only as the last token/ },
    { pattern: '>.created', says: /only as the last token/ },
    { pattern: 'events.>.>', says: /only as the last token/ },
    { pattern: 'orders..created', says: /empty token/ },
    { pattern: 'orders.', says: /empty token/ },
    { pattern: '.orders', says: /empty token/ },
    { pattern: '', says: /empty token/ },
    { pattern: 'orders.new order', says: /space, tab or line break/ },
    { pattern: 'orders.{a} b', says: /space, tab or line break outside its \{name\} parameters/ },
    { pattern: 'orders.{a b', says: /space, tab or line break/ },
  ];

  for (const { pattern, says } of refused) {
    it(`refuses ${JSON.stringify(pattern)}, which can never receive a message, naming it and the reason`, () => {
      let message = '';
      try {
        validateNatsSubscriptionPattern(pattern);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain(`"${pattern}"`);
      expect(message).toMatch(says);
    });
  }

  it('leaves a # in any position to toNatsSubject, which refuses it with its own rule', () => {
    expect(() => validateNatsSubscriptionPattern('events.#.created')).not.toThrow();
    expect(() => toNatsSubject('events.#.created')).toThrow(/final token/);
  });

  // Exactly the characters the nats.js client refuses in a subject (nats-core `whitespaceRegex`).
  for (const [label, separator] of [['a space', ' '], ['a tab', '\t'], ['a line feed', '\n'], ['a carriage return', '\r']]) {
    it(`refuses ${label} outside a {name}, and accepts it inside one`, () => {
      expect(() => validateNatsSubscriptionPattern(`orders.a${separator}b`)).toThrow(/space, tab or line break/);
      expect(() => validateNatsSubscriptionPattern(`orders.a${separator}b`)).toThrow(`"orders.a${separator}b"`);
      expect(() => validateNatsSubscriptionPattern(`orders.{a${separator}b}`)).not.toThrow();
    });
  }

  // Valid subject characters to the client and the server, which deliver such a literal subject.
  for (const [label, character] of [
    ['a no-break space', '\u00A0'],
    ['an ideographic space', '\u3000'],
    ['a vertical tab', '\v'],
    ['a form feed', '\f'],
  ]) {
    it(`accepts ${label}, which a NATS subject may carry`, () => {
      expect(() => validateNatsSubscriptionPattern(`orders.a${character}b`)).not.toThrow();
      expect(toNatsSubject(`orders.a${character}b`)).toBe(`orders.a${character}b`);
    });
  }

  it('sends a parameter whose name holds whitespace as the one-token wildcard', () => {
    expect(toNatsSubject('orders.{a b}')).toBe('orders.*');
    expect(createQueuePatternMatcher('orders.{a b}')('orders.a')).toEqual({ matched: true, params: { [SPACED_NAME]: 'a' } });
  });

  it('reads a wildcard character inside a parameter name as part of the name', () => {
    // `{a*}` is a parameter that happens to be named `a*`; it captures one whole token.
    expect(() => validateNatsSubscriptionPattern('orders.{a*}')).not.toThrow();
  });
});
