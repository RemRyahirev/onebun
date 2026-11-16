/**
 * JetStream Queue Adapter Integration Tests
 *
 * Runs against a real nats-server with JetStream enabled, started via
 * testcontainers. Unconditional by design — no env gate and no skip, matching
 * the convention in `nats.adapter.integration.test.ts`.
 */

import { AckPolicy, DeliverPolicy } from '@nats-io/jetstream';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';


import type { Message } from '@onebun/core';
import {
  BaseController,
  Controller,
  Cron,
  Interval,
  Module,
  OnQueueError,
  OneBunApplication,
  Subscribe,
  matchQueuePattern,
} from '@onebun/core';
import {
  createNatsContainer,
  makeMockLoggerLayer,
  type TestContainer,
} from '@onebun/core/testing';

import { hashReconcileConfig } from '../src/config-stamp';
import { JetStreamQueueAdapter } from '../src/jetstream.adapter';
import { NatsQueueAdapter } from '../src/nats.adapter';
import { toNatsSubject } from '../src/subject';

/** Mirrors the adapter's durable naming so the test does not hardcode a digest. */
function durableNameFor(group: string, pattern: string): string {
  const subject = toNatsSubject(pattern);
  const sanitize = (value: string): string => value.replace(/[^-\w]/g, '_');

  return `${sanitize(group)}--${sanitize(subject)}--${hashReconcileConfig({ group, subject }).slice(0, 12)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** Reads a private field off an adapter, as the stamp and filter cases already do inline. */
function asAny(obj: unknown): AnyRecord {
  return obj as AnyRecord;
}

const CONTAINER_BOOT_MS = 120_000;
const CASE_TIMEOUT_MS = 30_000;
/** A parameter name holding whitespace, which never reaches the wire. */
const SPACED_NAME = 'a b';
const POLL_DEADLINE_MS = 10_000;
const POLL_INTERVAL_MS = 25;

/**
 * The only wait primitive in this file. Every other case polls a predicate
 * rather than sleeping for a guessed duration, so a slow container costs
 * latency instead of a flake.
 */
async function pollUntil(
  predicate: () => boolean | Promise<boolean>,
  deadlineMs: number = POLL_DEADLINE_MS,
): Promise<void> {
  const startedAt = Date.now();

  for (;;) {
    if (await predicate()) {
      return;
    }

    if (Date.now() - startedAt > deadlineMs) {
      throw new Error(`pollUntil: predicate did not hold within ${deadlineMs}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

describe('JetStreamQueueAdapter Integration', () => {
  let nats: TestContainer;
  let adapter: JetStreamQueueAdapter | null = null;

  beforeAll(async () => {
    nats = await createNatsContainer({ enableJetStream: true });
  }, CONTAINER_BOOT_MS);

  afterAll(async () => {
    await nats.stop();
  }, CONTAINER_BOOT_MS);

  afterEach(async () => {
    if (adapter?.isConnected()) {
      await adapter.disconnect();
    }
    adapter = null;
  });

  function makeAdapter(streamName: string, subjects: string[]): JetStreamQueueAdapter {
    adapter = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [{ name: streamName, subjects }],
    });

    return adapter;
  }

  it('delivers a published message to a subscriber and acknowledges it', async () => {
    const js = makeAdapter('ITEST_EVENTS', ['itest.>']);
    await js.connect();

    const received: Array<Message<{ n: number }>> = [];

    await js.subscribe<{ n: number }>(
      'itest.created',
      async (message) => {
        received.push(message);
        await message.ack();
      },
      { ackMode: 'manual', group: 'itest-workers' },
    );

    await js.publish('itest.created', { n: 42 });

    await pollUntil(() => received.length === 1);

    expect(received[0].data.n).toBe(42);
    expect(received[0].pattern).toBe('itest.created');
  }, CASE_TIMEOUT_MS);

  it('delivers to a subscription whose pattern carries a named parameter', async () => {
    // The bug this proves gone: `orders.{id}` used to be sent verbatim as
    // `filter_subject`, which matches no subject on the broker. Nothing errored —
    // `consumers.add` succeeded and the subscription was simply, silently dead.
    const js = makeAdapter('ITEST_PARAMS', ['params.>']);
    await js.connect();

    const received: Array<Message<{ n: number }>> = [];

    await js.subscribe<{ n: number }>('params.{id}', async (message) => {
      received.push(message);
      await message.ack();
    }, { group: 'itest-params', ackMode: 'manual' });

    await js.publish('params.123', { n: 7 });

    await pollUntil(() => received.length === 1);

    expect(received[0].data.n).toBe(7);
    expect(received[0].pattern).toBe('params.123');
    // The transport widened to `params.*`, so the broker captured nothing. The value comes
    // from the in-process match that narrowed it back, and reaches the handler as `params` —
    // re-running the matcher by hand, which this test used to do, is no longer necessary.
    expect(received[0].params).toEqual({ id: '123' });
    expect(matchQueuePattern('params.{id}', received[0].pattern).params.id).toBe('123');
  }, CASE_TIMEOUT_MS);

  it('captures every parameter of a multi-parameter pattern', async () => {
    // A single capture can be right by coincidence; two at different depths cannot. Both
    // segments have to survive the widening to `params.*.items.*` and come back apart.
    // Its own subject prefix: NATS refuses a stream whose subjects overlap another stream's,
    // and `ITEST_PARAMS` above already binds `params.>`.
    const js = makeAdapter('ITEST_MULTIPARAMS', ['multiparams.>']);
    await js.connect();

    const received: Array<Message<{ n: number }>> = [];

    await js.subscribe<{ n: number }>('multiparams.{id}.items.{itemId}', async (message) => {
      received.push(message);
      await message.ack();
    }, { group: 'itest-multiparams', ackMode: 'manual' });

    await js.publish('multiparams.42.items.abc', { n: 1 });

    await pollUntil(() => received.length === 1);

    expect(received[0].params).toEqual({ id: '42', itemId: 'abc' });
  }, CASE_TIMEOUT_MS);

  it('answers with an empty object for a pattern that captures nothing', async () => {
    const js = makeAdapter('ITEST_NOPARAMS', ['noparams.>']);
    await js.connect();

    const received: Array<Message<{ n: number }>> = [];

    await js.subscribe<{ n: number }>('noparams.*', async (message) => {
      received.push(message);
      await message.ack();
    }, { group: 'itest-noparams', ackMode: 'manual' });

    await js.publish('noparams.created', { n: 1 });

    await pollUntil(() => received.length === 1);

    // Never undefined, so a handler reads `message.params.x` without guarding the access.
    expect(received[0].params).toEqual({});
  }, CASE_TIMEOUT_MS);

  it('round-trips a config-hash stamp through stream and consumer metadata', async () => {
    // Proves the primitive the stream- and consumer-reconciliation items depend on:
    // `metadata` is writable on create AND update and reads back verbatim.
    // Requires nats-server 2.10+, which `createNatsContainer` pins by default.
    const js = makeAdapter('ITEST_STAMP', ['stamp.>']);
    await js.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;
    const knownHash = '3ffe000520f9d8555c61f140cbf093e7';

    // --- stream: written on update, read back through streams.info ---
    const before = await jsm.streams.info('ITEST_STAMP');
    await jsm.streams.update('ITEST_STAMP', {
      ...before.config,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- literal wire key
      metadata: { 'config-hash': knownHash },
    });
    const afterStream = await jsm.streams.info('ITEST_STAMP');

    expect(afterStream.config.metadata['config-hash']).toBe(knownHash);

    // --- consumer: written on create, read back through consumers.info ---
    await jsm.consumers.add('ITEST_STAMP', {
      durable_name: 'stamped-consumer',
      ack_policy: AckPolicy.Explicit,
      filter_subject: 'stamp.one',
      // eslint-disable-next-line @typescript-eslint/naming-convention -- literal wire key
      metadata: { 'config-hash': knownHash },
    });
    const afterConsumer = await jsm.consumers.info('ITEST_STAMP', 'stamped-consumer');

    expect(afterConsumer.config.metadata['config-hash']).toBe(knownHash);
  }, CASE_TIMEOUT_MS);

  it('redelivers a message whose handler throws, under the default ack mode', async () => {
    // The regression that proves explicit acks are real: under ack_policy=none the
    // server tracked nothing and a throwing handler was never redelivered. Mocks
    // cannot fake this — only the broker decides to redeliver.
    const js = makeAdapter('ITEST_RETRY', ['retry.>']);
    await js.connect();

    let attempts = 0;

    await js.subscribe(
      'retry.flaky',
      async () => {
        attempts += 1;
        throw new Error('handler failed');
      },
      { group: 'itest-retry', retry: { attempts: 3 } },
    );

    await js.publish('retry.flaky', { n: 1 });

    await pollUntil(() => attempts >= 3, POLL_DEADLINE_MS);

    expect(attempts).toBe(3);
  }, CASE_TIMEOUT_MS);

  it('paces redeliveries with the declared backoff, not with ack_wait', async () => {
    // The gaps are the whole claim, and only the broker produces them. `ack_wait` here is
    // the 30-second default, so a nak carrying no delay redelivers at once and a nak whose
    // delay were dropped would not come back inside this test at all — the two failure
    // modes this replaces are both visible in the timings rather than in a mock's arguments.
    const js = makeAdapter('ITEST_BACKOFF', ['backoff.>']);
    await js.connect();

    const arrivals: number[] = [];

    await js.subscribe(
      'backoff.flaky',
      async () => {
        arrivals.push(Date.now());
        throw new Error('handler failed');
      },
      { group: 'itest-backoff', retry: { attempts: 3, backoff: 'exponential', delay: 400 } },
    );

    await js.publish('backoff.flaky', { n: 1 });
    await pollUntil(() => arrivals.length >= 3);

    const firstGap = arrivals[1]! - arrivals[0]!;
    const secondGap = arrivals[2]! - arrivals[1]!;

    // 400ms then 800ms, with room for the round trip in either direction.
    expect(firstGap).toBeGreaterThanOrEqual(350);
    expect(firstGap).toBeLessThan(1_000);
    expect(secondGap).toBeGreaterThanOrEqual(750);
    expect(secondGap).toBeLessThan(1_600);
    // The ladder climbs: the second wait is a doubling, not a repeat of the first.
    expect(secondGap).toBeGreaterThan(firstGap + 200);
  }, CASE_TIMEOUT_MS);

  it('reconciles a changed consumer config and no-ops on an unchanged one', async () => {
    const js = makeAdapter('ITEST_RECONCILE', ['reconcile.>']);
    await js.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;
    const group = 'itest-reconcile';
    // The durable is per (group, pattern) and carries a digest of the raw pair, so it is
    // derived here the same way the adapter derives it rather than hardcoded.
    const durable = durableNameFor(group, 'reconcile.one');

    await js.subscribe('reconcile.one', async () => undefined, { group, prefetch: 11 });

    const first = await jsm.consumers.info('ITEST_RECONCILE', durable);

    expect(first.config.max_ack_pending).toBe(11);

    const firstHash = first.config.metadata['onebun.config-hash'];

    expect(firstHash).toBeDefined();

    // Second subscribe with a CHANGED config: the server must report the new value
    // and the previous hash must chain to what the first subscribe wrote.
    await js.disconnect();
    const js2 = makeAdapter('ITEST_RECONCILE', ['reconcile.>']);
    await js2.connect();
    await js2.subscribe('reconcile.one', async () => undefined, { group, prefetch: 22 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm2 = (js2 as any).jsm as AnyRecord;
    const second = await jsm2.consumers.info('ITEST_RECONCILE', durable);

    expect(second.config.max_ack_pending).toBe(22);
    expect(second.config.metadata['onebun.prev-config-hash']).toBe(firstHash);

    const secondReconciledAt = second.config.metadata['onebun.reconciled-at'];

    // Third subscribe, IDENTICAL to the second: the no-op path must not write at all,
    // so the timestamp stays byte-identical.
    await js2.disconnect();
    const js3 = makeAdapter('ITEST_RECONCILE', ['reconcile.>']);
    await js3.connect();
    await js3.subscribe('reconcile.one', async () => undefined, { group, prefetch: 22 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm3 = (js3 as any).jsm as AnyRecord;
    const third = await jsm3.consumers.info('ITEST_RECONCILE', durable);

    expect(third.config.metadata['onebun.reconciled-at']).toBe(secondReconciledAt);
  }, CASE_TIMEOUT_MS);

  it('does not wipe limits set out of band, and rewrites nothing when unchanged', async () => {
    // The regression: the adapter used to send every stream key on every connect, so an
    // undeclared max_msgs travelled as an explicit undefined and the client's shallow
    // Object.assign wiped it. Only a real server can prove it survives.
    const streamName = 'ITEST_PREPROVISIONED';
    const bootstrap = makeAdapter(streamName, ['preprov.>']);
    await bootstrap.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bootstrapJsm = (bootstrap as any).jsm as AnyRecord;
    const before = await bootstrapJsm.streams.info(streamName);

    // Set a limit out of band, the way an operator would.
    await bootstrapJsm.streams.update(streamName, { ...before.config, max_msgs: 1000 });
    await bootstrap.disconnect();

    // A fresh adapter declaring only { name, subjects } must leave that limit alone.
    const js = makeAdapter(streamName, ['preprov.>']);
    await js.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;
    const afterFirst = await jsm.streams.info(streamName);

    expect(afterFirst.config.max_msgs).toBe(1000);

    const reconciledAt = afterFirst.config.metadata['onebun.reconciled-at'];

    expect(reconciledAt).toBeDefined();

    // A second connect with identical options must perform no write at all.
    await js.disconnect();
    const js2 = makeAdapter(streamName, ['preprov.>']);
    await js2.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm2 = (js2 as any).jsm as AnyRecord;
    const afterSecond = await jsm2.streams.info(streamName);

    expect(afterSecond.config.metadata['onebun.reconciled-at']).toBe(reconciledAt);
    expect(afterSecond.config.max_msgs).toBe(1000);
  }, CASE_TIMEOUT_MS);

  it('does not replay retained messages to a fresh group-less subscription', async () => {
    // deliver_policy new, asserted where it actually matters: an ephemeral consumer
    // started after the fact must not drain everything the stream retained.
    const streamName = 'ITEST_EPHEMERAL';
    const producer = makeAdapter(streamName, ['ephemeral.>']);
    await producer.connect();

    await producer.publish('ephemeral.event', { n: 1 });
    await producer.publish('ephemeral.event', { n: 2 });
    await producer.publish('ephemeral.event', { n: 3 });
    await producer.disconnect();

    const latecomer = makeAdapter(streamName, ['ephemeral.>']);
    await latecomer.connect();

    const received: unknown[] = [];
    await latecomer.subscribe('ephemeral.event', async (message) => {
      received.push(message.data);
      await message.ack();
    });

    // Give the consumer a real window to deliver anything it was going to deliver.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(received).toHaveLength(0);
  }, CASE_TIMEOUT_MS);

  it('routes each pattern in a shared group to its own consumer', async () => {
    // Two subscriptions sharing a group but filtering different subjects used to
    // collide on one durable named after the group, and the second silently won —
    // one subject received everything and the other received nothing.
    const streamName = 'ITEST_GROUPED';
    const js = makeAdapter(streamName, ['grouped.>']);
    await js.connect();

    const alpha: Array<{ n: number }> = [];
    const beta: Array<{ n: number }> = [];

    await js.subscribe<{ n: number }>('grouped.alpha', async (message) => {
      alpha.push(message.data);
      await message.ack();
    }, { group: 'shared-workers', ackMode: 'manual' });

    await js.subscribe<{ n: number }>('grouped.beta', async (message) => {
      beta.push(message.data);
      await message.ack();
    }, { group: 'shared-workers', ackMode: 'manual' });

    for (let n = 0; n < 5; n += 1) {
      await js.publish('grouped.alpha', { n });
    }
    await js.publish('grouped.beta', { n: 99 });

    await pollUntil(() => alpha.length === 5 && beta.length === 1);

    expect(alpha).toHaveLength(5);
    expect(beta).toHaveLength(1);
    expect(beta[0].n).toBe(99);
  }, CASE_TIMEOUT_MS);

  it('redelivers on nack(true) and terminates on nack(false)', async () => {
    // Proving a NON-event without a wall-clock guess: one subscription, two messages.
    // `redeliver` is nacked with requeue on every delivery, so watching it reach 3
    // attempts means the broker has completed two full ack_wait/redelivery rounds —
    // strictly more time than a single redelivery of `terminate` would have needed.
    // If term() were broken, `terminated` would already be >= 2 by that point.
    const js = makeAdapter('ITEST_TERM', ['term.>']);
    await js.connect();

    let redeliverAttempts = 0;
    let terminateAttempts = 0;

    await js.subscribe<{ kind: string }>(
      'term.case',
      async (message) => {
        if (message.data.kind === 'redeliver') {
          redeliverAttempts += 1;
          await message.nack(true);

          return;
        }

        terminateAttempts += 1;
        await message.nack(false);
      },
      { ackMode: 'manual', group: 'itest-term', retry: { attempts: 3 } },
    );

    await js.publish('term.case', { kind: 'redeliver' });
    await js.publish('term.case', { kind: 'terminate' });

    await pollUntil(() => redeliverAttempts >= 3);

    expect(redeliverAttempts).toBe(3);
    expect(terminateAttempts).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('leaves no ephemeral consumer behind after unsubscribe', async () => {
    const js = makeAdapter('ITEST_LIFECYCLE', ['lifecycle.>']);
    await js.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;

    async function consumerCount(): Promise<number> {
      const names: string[] = [];
      for await (const info of await jsm.consumers.list('ITEST_LIFECYCLE')) {
        names.push(info.name);
      }

      return names.length;
    }

    expect(await consumerCount()).toBe(0);

    const subscription = await js.subscribe('lifecycle.one', async () => undefined);

    expect(await consumerCount()).toBe(1);

    await subscription.unsubscribe();

    await pollUntil(async () => await consumerCount() === 0);
    expect(await consumerCount()).toBe(0);

    // Repeated cycles must not accumulate: the leak was one consumer per subscribe.
    for (let i = 0; i < 50; i += 1) {
      const cycle = await js.subscribe('lifecycle.one', async () => undefined);
      await cycle.unsubscribe();
    }

    await pollUntil(async () => await consumerCount() === 0);
    expect(await consumerCount()).toBe(0);
  }, CASE_TIMEOUT_MS);

  it('leaves no ephemeral behind on disconnect, and never deletes a durable', async () => {
    const js = makeAdapter('ITEST_RELEASE', ['release.>']);
    await js.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;
    const group = 'itest-release';
    const durable = durableNameFor(group, 'release.durable');

    await js.subscribe('release.ephemeral', async () => undefined);
    await js.subscribe('release.durable', async (message) => {
      await message.ack();
    }, { group, ackMode: 'manual' });

    await js.publish('release.durable', { n: 1 });
    await pollUntil(async () => (await jsm.consumers.info('ITEST_RELEASE', durable)).delivered.stream_seq > 0);

    const ackFloorBefore = (await jsm.consumers.info('ITEST_RELEASE', durable)).ack_floor.stream_seq;

    await js.disconnect();

    // A fresh connection observes what the disconnect left on the server.
    const probe = makeAdapter('ITEST_RELEASE', ['release.>']);
    await probe.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probeJsm = (probe as any).jsm as AnyRecord;

    async function consumerNames(): Promise<string[]> {
      const names: string[] = [];
      for await (const info of await probeJsm.consumers.list('ITEST_RELEASE')) {
        names.push(info.name);
      }

      return names.sort();
    }

    // Wait for the ephemeral to be gone, then assert the exact list. Splitting it this way is
    // deliberate: the poll waits only for the condition that legitimately settles late, so a
    // DELETED DURABLE — the regression this test exists for — fails immediately with a
    // readable `[] !== [durable]` instead of timing out after POLL_DEADLINE_MS.
    //
    // The wait is needed because two things make the ephemeral's disappearance asynchronous
    // relative to this line, and both widen under the load of a full suite run:
    //   - `disconnect()` bounds the release step at RELEASE_TIMEOUT_MS and resolves on that
    //     timer whether or not the server-side deletes have completed;
    //   - the delete was issued on the connection that is now closed, and this list runs on a
    //     NEW one — JetStream orders API calls per connection, not across them.
    // Asserting immediately made this the suite's intermittent failure: green in isolation,
    // red in roughly one full run in three.
    //
    // What the ephemeral half does NOT prove: that the ADAPTER deleted it. Measured — with
    // `releaseSubscription` stubbed out entirely, this test still passes, because the server
    // reaps an ephemeral once the connection that created it goes away. The adapter-side
    // guarantee is pinned by 'leaves no ephemeral consumer behind after unsubscribe', where
    // the connection stays open and the server has no reason to reap anything.
    await pollUntil(async () => (await consumerNames()).length <= 1);

    // The durable survives; the ephemeral does not.
    expect(await consumerNames()).toEqual([durable]);
    expect((await probeJsm.consumers.info('ITEST_RELEASE', durable)).ack_floor.stream_seq)
      .toBe(ackFloorBefore);

    // And the preserved floor is observable: re-subscribing must not replay what the
    // previous instance already acknowledged.
    const replayed: Array<{ n: number }> = [];
    await probe.subscribe<{ n: number }>('release.durable', async (message) => {
      replayed.push(message.data);
      await message.ack();
    }, { group, ackMode: 'manual' });

    // A marker rather than a fixed sleep. The assertion is a NEGATIVE — "the old message was
    // not redelivered" — and a negative cannot be polled directly, so it is turned into a
    // positive: publish a new message and wait for it. JetStream delivers a consumer's
    // backlog in stream order, so anything replayed would have arrived BEFORE the marker.
    // That also makes the test stronger than the sleep it replaces, which passed equally well
    // when the subscription was delivering nothing at all.
    await probe.publish('release.durable', { n: 2 });
    await pollUntil(() => replayed.length > 0);

    expect(replayed).toEqual([{ n: 2 }]);
  }, CASE_TIMEOUT_MS);

  it('recovers when the consumer is deleted out of band', async () => {
    // The stall this fixes is invisible: the client retries CONSUMER.INFO forever, the
    // loop parks, and isConnected() keeps saying healthy. Only a real server can delete
    // the consumer underneath a live subscription.
    const streamName = 'ITEST_VANISH';
    const group = 'itest-vanish';
    const js = makeAdapter(streamName, ['vanish.>']);
    await js.connect();

    const received: Array<{ n: number }> = [];
    await js.subscribe<{ n: number }>('vanish.one', async (message) => {
      received.push(message.data);
      await message.ack();
    }, { group, ackMode: 'manual' });

    await js.publish('vanish.one', { n: 1 });
    await pollUntil(() => received.length === 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;
    const durable = durableNameFor(group, 'vanish.one');

    await jsm.consumers.delete(streamName, durable);

    // The consumer comes back under the same name, without anyone restarting the app.
    await pollUntil(async () => {
      const names: string[] = [];
      for await (const info of await jsm.consumers.list(streamName)) {
        names.push(info.name);
      }

      return names.includes(durable);
    });

    // And delivery resumes. Published AFTER recovery on purpose: the rebuilt consumer
    // carries deliver_policy new, so anything published while it was gone is not
    // delivered to it — deleting a consumer destroys its position, and no re-creation
    // can recover a position the server no longer has.
    await js.publish('vanish.one', { n: 2 });
    await pollUntil(() => received.some(d => d.n === 2));

    expect(received.map(d => d.n)).toContain(2);
  }, CASE_TIMEOUT_MS);

  it('reports a missing consumer with the not-found API code', async () => {
    // The numeric classifier the adapter will use instead of a bare catch.
    const js = makeAdapter('ITEST_CODES', ['codes.>']);
    await js.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;

    let observedCode: number | undefined;
    try {
      await jsm.consumers.info('ITEST_CODES', 'no-such-consumer');
    } catch (error) {
      observedCode = (error as AnyRecord).code;
    }

    expect(observedCode).toBe(10014);
  }, CASE_TIMEOUT_MS);

  it('decommissions a durable that unsubscribe deliberately left behind', async () => {
    // The whole point of the method: unsubscribe() preserves the durable on purpose, so
    // only a real server can show that this is what actually removes it.
    const streamName = 'ITEST_DECOMMISSION';
    const group = 'itest-decommission';
    const js = makeAdapter(streamName, ['decom.>']);
    await js.connect();

    const received: Array<{ n: number }> = [];
    const subscription = await js.subscribe<{ n: number }>('decom.one', async (message) => {
      received.push(message.data);
      await message.ack();
    }, { group, ackMode: 'manual' });

    await js.publish('decom.one', { n: 1 });
    await pollUntil(() => received.length === 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;
    const durable = durableNameFor(group, 'decom.one');

    const listNames = async (): Promise<string[]> => {
      const names: string[] = [];
      for await (const info of await jsm.consumers.list(streamName)) {
        names.push(info.name);
      }

      return names;
    };

    await subscription.unsubscribe();

    // Still there — that is the documented contract, not an oversight.
    expect(await listNames()).toContain(durable);

    expect(await js.deleteDurableConsumer('decom.one', group)).toBe(true);
    await pollUntil(async () => !(await listNames()).includes(durable));

    expect(await listNames()).not.toContain(durable);
    // Idempotent: a second call finds nothing to remove and says so rather than throwing.
    expect(await js.deleteDurableConsumer('decom.one', group)).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('deduplicates repeated message ids inside the window, and only those', async () => {
    // Only the server deduplicates, and only off the Nats-Msg-Id header — a mock cannot
    // show that the second publish was dropped while publish() still resolved.
    const streamName = 'ITEST_DEDUP';
    const js = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [{ name: streamName, subjects: ['dedup.>'], duplicateWindow: 120_000_000_000 }],
    });
    adapter = js;
    await js.connect();

    const received: Array<{ n: number }> = [];
    await js.subscribe<{ n: number }>('dedup.one', async (message) => {
      received.push(message.data);
      await message.ack();
    }, { group: 'itest-dedup', ackMode: 'manual' });

    // Same id twice: the second is dropped server-side, and publish() still resolves.
    await js.publish('dedup.one', { n: 1 }, { messageId: 'same-id' });
    await js.publish('dedup.one', { n: 2 }, { messageId: 'same-id' });
    // Two distinct ids: both stored.
    await js.publish('dedup.one', { n: 3 }, { messageId: 'other-a' });
    await js.publish('dedup.one', { n: 4 }, { messageId: 'other-b' });
    // No id at all: no deduplication to apply.
    await js.publish('dedup.one', { n: 5 });
    await js.publish('dedup.one', { n: 6 });

    await pollUntil(() => received.length >= 5);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(received.map(d => d.n).sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 6]);
  }, CASE_TIMEOUT_MS);

  it('publishes a messageId that a core-NATS observer of the same subject still receives', async () => {
    // onebun-FB-39. The id travels as the Nats-Msg-Id header, and a NatsQueueAdapter watching the
    // subject — a way to observe a workqueue without a second, overlapping consumer — receives
    // the message with that header on it. Such a message used to end the observer's
    // subscription, so the id-less publish after it is the one that proves the observer lived.
    const js = makeAdapter('ITEST_OBSERVED', ['observed.>']);
    await js.connect();
    const observer = new NatsQueueAdapter({ servers: nats.url });

    try {
      await observer.connect();
      const seen: number[] = [];
      await observer.subscribe<{ n: number }>('observed.#', async (message) => {
        seen.push(message.data.n);
      }, { ackMode: 'none' });
      // subscribe() only queues the SUB on the observer's connection. The publishes below travel
      // on another one, so without this round trip they can reach the server first and miss it.
      await asAny(observer).client.getConnection().flush();

      await js.publish('observed.one', { n: 1 }, { messageId: 'outbox-1' });
      await js.publish('observed.two', { n: 2 });
      await pollUntil(() => seen.length === 2);

      expect(seen).toEqual([1, 2]);
    } finally {
      await observer.disconnect();
    }
  }, CASE_TIMEOUT_MS);

  it('takes pattern, params and stream from the delivery, and an envelope cannot redirect them', async () => {
    // onebun-FB-53: a client allowed to publish on `forge.a.>` writes an envelope naming
    // `forge.b.result.999`. The server routes by subject, so only the subscription covering
    // `forge.a.result.1` receives it, and what it reads must be the subject, not the claim.
    const js = makeAdapter('ITEST_FORGE', ['forge.>']);
    await js.connect();

    const wild: Array<Message<unknown>> = [];
    const onlyB: Array<Message<unknown>> = [];
    await js.subscribe('forge.*.result.{id}', async (message) => {
      wild.push(message);
    }, { group: 'itest-forge-wild' });
    await js.subscribe('forge.b.result.{id}', async (message) => {
      onlyB.push(message);
    }, { group: 'itest-forge-only-b' });

    const envelope = {
      id: 'forged-1', pattern: 'forge.b.result.999', data: {}, timestamp: Date.now(), metadata: { claimedBy: 'b' },
    };
    await asAny(js).js.publish(
      'forge.a.result.1',
      new TextEncoder().encode(JSON.stringify(envelope)),
      { msgID: 'forged-1' },
    );
    // Published through the adapter: the values a handler reads are the ones it always read.
    await js.publish('forge.b.result.2', {}, { messageId: 'honest-2' });

    await pollUntil(() => wild.length === 2 && onlyB.length === 1);

    const forged = wild.find(message => message.id === 'forged-1')!;
    expect(forged.subject).toBe('forge.a.result.1');
    expect(forged.pattern).toBe('forge.a.result.1');
    expect(forged.params).toEqual({ id: '1' });
    expect(forged.stream).toBe('ITEST_FORGE');
    expect(forged.headers?.get('Nats-Msg-Id')).toEqual(['forged-1']);
    // The envelope's own claims still arrive as the publisher wrote them.
    expect(forged.metadata).toEqual({ claimedBy: 'b' });

    const honest = wild.find(message => message.id === 'honest-2')!;
    expect(honest.pattern).toBe('forge.b.result.2');
    expect(honest.subject).toBe('forge.b.result.2');
    expect(honest.params).toEqual({ id: '2' });

    // The application-B-only subscription saw the honest message and nothing else.
    expect(onlyB.map(message => message.subject)).toEqual(['forge.b.result.2']);
    expect(onlyB[0].params).toEqual({ id: '2' });
  }, CASE_TIMEOUT_MS);

  describe('a message published with undefined data', () => {
    // `JSON.stringify` drops `data: undefined`, so these envelopes carry no `data` key at all —
    // and they are the framework's own writes, which the consume loop has to deliver.

    it('delivers publish(topic, undefined) to the handler with data undefined', async () => {
      const js = makeAdapter('ITEST_NODATA', ['nodata.>']);
      await js.connect();

      const errors: Error[] = [];
      js.on('onError', (error) => {
        errors.push(error);
      });

      const received: Array<Message<unknown>> = [];
      await js.subscribe('nodata.direct', async (message) => {
        received.push(message);
      }, { group: 'itest-nodata' });

      const id = await js.publish('nodata.direct', undefined);
      await pollUntil(() => received.length === 1);

      expect(received[0].id).toBe(id);
      expect(received[0].data).toBeUndefined();
      expect(received[0].subject).toBe('nodata.direct');
      expect(typeof received[0].timestamp).toBe('number');
      expect(errors).toEqual([]);
    }, CASE_TIMEOUT_MS);

    it('dead-letters a message without data, and the dead-letter reader receives it', async () => {
      // The republish writes `message.data` — `undefined` again — so the dead letter is a
      // data-less envelope too. Refusing it would lose the one copy the queue exists to keep.
      const js = new JetStreamQueueAdapter({
        servers: nats.url,
        streams: [
          { name: 'ITEST_NODATA_SRC', subjects: ['nodatasrc.>'] },
          { name: 'ITEST_NODATA_DLQ', subjects: ['nodatadlq.>'] },
        ],
      });
      adapter = js;
      await js.connect();

      const errors: Error[] = [];
      js.on('onError', (error) => {
        errors.push(error);
      });

      const parked: Array<Message<unknown>> = [];
      await js.subscribe('nodatadlq.parked', async (message) => {
        parked.push(message);
      }, { group: 'itest-nodata-dlq-reader' });

      let attempts = 0;
      await js.subscribe('nodatasrc.one', async () => {
        attempts += 1;
        throw new Error('always fails');
      }, { group: 'itest-nodata-dlq', deadLetter: { queue: 'nodatadlq.parked', maxRetries: 1 } });

      await js.publish('nodatasrc.one', undefined);
      await pollUntil(() => parked.length === 1);

      expect(attempts).toBe(1);
      expect(parked[0].data).toBeUndefined();
      expect(parked[0].metadata['dlq.originalPattern']).toBe('nodatasrc.one');
      expect(errors).toEqual([]);
    }, CASE_TIMEOUT_MS);

    it('redelivers a data-less message whose handler throws, and the retry reads data undefined too', async () => {
      // A redelivery is the same stored message, so it passes the same envelope check again —
      // a refusal there would turn the retry into a termination.
      const streamName = 'ITEST_NODATA_RETRY';
      const group = 'itest-nodata-retry';
      const js = new JetStreamQueueAdapter({
        servers: nats.url,
        streams: [{ name: streamName, subjects: ['nodataretry.>'] }],
        consumerConfig: { ackWait: 1_000_000_000 },
      });
      adapter = js;
      await js.connect();

      const errors: Error[] = [];
      js.on('onError', (error) => {
        errors.push(error);
      });

      const seen: Array<{ attempt?: number; data: unknown }> = [];
      await js.subscribe('nodataretry.one', async (message) => {
        seen.push({ attempt: message.attempt, data: message.data });
        if (message.attempt === 1) {
          throw new Error('first attempt fails');
        }
      }, { group, retry: { attempts: 3, delay: 50 } });

      await js.publish('nodataretry.one', undefined);
      await pollUntil(() => seen.length === 2);

      // The second attempt succeeded and was acknowledged: nothing is left in flight.
      const jsm = asAny(js).jsm as AnyRecord;
      await pollUntil(async () => {
        const info = await jsm.consumers.info(streamName, durableNameFor(group, 'nodataretry.one'));

        return info.num_ack_pending === 0 && info.num_pending === 0;
      });

      expect(seen).toEqual([{ attempt: 1, data: undefined }, { attempt: 2, data: undefined }]);
      expect(errors).toEqual([]);
    }, CASE_TIMEOUT_MS);

    it('delivers every tick of a @Cron and an @Interval job whose method returns nothing', async () => {
      // The decorated method is the data provider, so a method that returns nothing publishes
      // `undefined` on every tick. Each tick must reach the subscriber; one that was refused
      // would surface through @OnQueueError instead.
      const runs = { cron: 0, interval: 0 };
      const delivered: Record<'cron' | 'interval', Array<Message<unknown>>> = { cron: [], interval: [] };
      const errors: Error[] = [];

      @Controller('/nodata-ticks')
      class TickController extends BaseController {
        @Cron('* * * * * *', { pattern: 'nodatatick.cron', name: 'itest-nodata-cron' })
        everySecond(): void {
          runs.cron += 1;
        }

        @Interval(200, { pattern: 'nodatatick.interval', name: 'itest-nodata-interval' })
        everyFewMilliseconds(): void {
          runs.interval += 1;
        }

        @Subscribe('nodatatick.cron', { group: 'itest-nodata-cron' })
        async onCronTick(message: Message<unknown>): Promise<void> {
          delivered.cron.push(message);
        }

        @Subscribe('nodatatick.interval', { group: 'itest-nodata-interval' })
        async onIntervalTick(message: Message<unknown>): Promise<void> {
          delivered.interval.push(message);
        }

        @OnQueueError()
        onQueueError(error: Error): void {
          errors.push(error);
        }
      }

      @Module({ controllers: [TickController] })
      class TickModule {}

      const app = new OneBunApplication(TickModule, {
        port: 0,
        loggerLayer: makeMockLoggerLayer(),
        metrics: { enabled: false },
        gracefulShutdown: false,
        queue: {
          adapter: JetStreamQueueAdapter,
          options: {
            servers: nats.url,
            streams: [{ name: 'ITEST_NODATA_TICKS', subjects: ['nodatatick.>'] }],
          },
        },
      });
      await app.start();

      try {
        await pollUntil(() => delivered.cron.length >= 2 && delivered.interval.length >= 2);
      } finally {
        await app.stop();
      }

      expect(runs.cron).toBeGreaterThanOrEqual(2);
      expect(runs.interval).toBeGreaterThanOrEqual(2);
      for (const message of [...delivered.cron, ...delivered.interval]) {
        expect(message.data).toBeUndefined();
      }
      expect(errors).toEqual([]);
    }, CASE_TIMEOUT_MS);
  });

  describe('payloads another producer publishes raw', () => {
    // Published raw, each on its own subject, then a framework message as the sync point. One
    // consumer delivers the stream in sequence order, so once the sync message is handled every
    // payload before it has been dealt with. The server's terminated advisory is what proves
    // `term()` — an ack and a term both settle the message, only a term announces itself.

    async function deliverRaw(
      streamName: string,
      prefix: string,
      payloads: ReadonlyArray<readonly [label: string, raw: string]>,
      expectTerminated: number,
    ): Promise<{ errors: Error[]; handled: Array<Message<unknown>>; terminated: number }> {
      const js = makeAdapter(streamName, [`${prefix}.>`]);
      await js.connect();

      const errors: Error[] = [];
      js.on('onError', (error) => {
        errors.push(error);
      });

      const connection = asAny(js).client.getConnection();
      let terminated = 0;
      const advisories = connection.subscribe(`$JS.EVENT.ADVISORY.CONSUMER.MSG_TERMINATED.${streamName}.>`, {
        callback() {
          terminated += 1;
        },
      });
      await connection.flush();

      const handled: Array<Message<unknown>> = [];
      await js.subscribe(`${prefix}.*`, async (message) => {
        handled.push(message);
      }, { group: `itest-${prefix}` });

      const synced = (): boolean => handled.some(message => message.subject === `${prefix}.sync`);

      try {
        const encoder = new TextEncoder();
        for (const [index, [, raw]] of payloads.entries()) {
          await asAny(js).js.publish(`${prefix}.${index}`, encoder.encode(raw));
        }
        await js.publish(`${prefix}.sync`, { sync: true });

        await pollUntil(() => synced() && terminated === expectTerminated).catch((cause: unknown) => {
          const subjects = handled.map(message => message.subject);
          throw new Error(
            `handled ${JSON.stringify(subjects)}, ${terminated} terminated, errors ${JSON.stringify(errors.map(e => e.message))}`,
            { cause },
          );
        });
      } finally {
        advisories.unsubscribe();
      }

      return { errors, handled, terminated };
    }

    it('terminates JSON that is not a OneBun envelope, and reports each one', async () => {
      // Neither a `data` key nor a string `id` with a numeric `timestamp`. Pinned so the shape
      // admitted for `publish(topic, undefined)` admits nothing more than that.
      const payloads = [
        ['an empty object', '{}'],
        ['an object from another producer', '{"hello":"world"}'],
        ['an object with an id but no timestamp', '{"id":"m"}'],
        ['an object with a timestamp but no id', '{"timestamp":1}'],
        ['an object whose id is not a string', '{"id":7,"timestamp":1}'],
        ['an object whose timestamp is not a number', '{"id":"m","timestamp":"1"}'],
        ['an array', '[1]'],
        ['a number', '42'],
        ['a string', '"x"'],
        ['null', 'null'],
        ['text that is not JSON', 'not json'],
      ] as const;

      const { errors, handled, terminated } = await deliverRaw('ITEST_FOREIGN_REFUSED', 'foreignrefused', payloads, payloads.length);

      expect(handled.map(message => message.subject)).toEqual(['foreignrefused.sync']);
      expect(terminated).toBe(payloads.length);
      expect(errors).toHaveLength(payloads.length);
      for (const [index] of payloads.entries()) {
        expect(errors[index].message).toContain(`"foreignrefused.${index}"`);
      }
    }, CASE_TIMEOUT_MS);

    it('delivers an object that carries data whatever its other fields, and a data-less one with an id and timestamp', async () => {
      // A stream is an integration surface: another producer that wraps its payload as
      // `{ "data": … }` is delivered, and the consume loop fills in what it left out.
      const payloads = [
        ['data and nothing else', '{"data":1}'],
        ['data whose value is null', '{"data":null}'],
        ['data with an id that is not a string', '{"id":7,"timestamp":1,"data":2}'],
        ['data with a timestamp that is not a number', '{"id":"m","timestamp":"1","data":3}'],
        ['data with metadata that is null', '{"id":"m","timestamp":1,"data":4,"metadata":null}'],
        ['data with metadata that is an array', '{"id":"m","timestamp":1,"data":5,"metadata":[]}'],
        ['data with an attempt that is not a number', '{"id":"m","timestamp":1,"data":6,"attempt":"2"}'],
        ['no data, a string id and a numeric timestamp', '{"id":"m","timestamp":1}'],
      ] as const;

      const { errors, handled, terminated } = await deliverRaw('ITEST_FOREIGN_DELIVERED', 'foreigndelivered', payloads, 0);

      expect(handled.map(message => message.subject)).toEqual([
        ...payloads.map((_, index) => `foreigndelivered.${index}`),
        'foreigndelivered.sync',
      ]);
      expect(handled.slice(0, payloads.length).map(message => message.data)).toEqual([1, null, 2, 3, 4, 5, 6, undefined]);

      // A `{ "data": … }`-only payload gets a generated id and the time of receipt.
      expect(handled[0].id).toEqual(expect.any(String));
      expect(handled[0].timestamp).toBeGreaterThan(1);
      expect(handled[0].metadata).toEqual({});

      expect(terminated).toBe(0);
      expect(errors).toEqual([]);
    }, CASE_TIMEOUT_MS);
  });

  it('counts attempts across real redeliveries', async () => {
    // The server is the only thing that can increment a delivery count, so the 1, 2, 3
    // progression the documented retry recipe branches on needs a real broker to prove.
    const streamName = 'ITEST_ATTEMPT';
    const js = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [{ name: streamName, subjects: ['attempt.>'] }],
      consumerConfig: { ackWait: 1_000_000_000 },
    });
    adapter = js;
    await js.connect();

    const seen: Array<{ attempt?: number; maxAttempts?: number }> = [];

    await js.subscribe('attempt.one', async (message) => {
      seen.push({ attempt: message.attempt, maxAttempts: message.maxAttempts });
      await message.nack(true);
    }, { group: 'itest-attempt', ackMode: 'manual', retry: { attempts: 3 } });

    await js.publish('attempt.one', { n: 1 });
    await pollUntil(() => seen.length >= 3);

    expect(seen.slice(0, 3).map(s => s.attempt)).toEqual([1, 2, 3]);
    expect(seen[0].maxAttempts).toBe(3);
  }, CASE_TIMEOUT_MS);

  it("delivers an ackMode 'none' subscription exactly once, even when the handler throws", async () => {
    // Only a real server can show that nothing is redelivered when it tracks nothing.
    const streamName = 'ITEST_NONE';
    const group = 'itest-none';
    const js = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [{ name: streamName, subjects: ['none.>'] }],
      consumerConfig: { ackWait: 1_000_000_000 },
    });
    adapter = js;
    await js.connect();

    let attempts = 0;
    await js.subscribe('none.one', async () => {
      attempts += 1;
      throw new Error('always fails');
    }, { group, ackMode: 'none' });

    await js.publish('none.one', { n: 1 });
    await pollUntil(() => attempts === 1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;
    const info = await jsm.consumers.info(streamName, durableNameFor(group, 'none.one'));

    expect(info.config.ack_policy).toBe('none');

    // Several ack_wait windows later it is still one delivery: with no acknowledgement
    // tracked there is nothing for the server to redeliver.
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(attempts).toBe(1);
  }, CASE_TIMEOUT_MS);

  it('routes an exhausted message to the dead-letter queue and stops redelivering it', async () => {
    // Only a real broker decides when a delivery is the last one, and only a real stream
    // can show the dead letter actually landed and surviving.
    const streamName = 'ITEST_DLQ_SRC';
    const dlqStream = 'ITEST_DLQ';
    const dlqSubject = 'dlq.parked';

    const js = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [
        { name: streamName, subjects: ['dlqsrc.>'] },
        { name: dlqStream, subjects: ['dlq.>'] },
      ],
      consumerConfig: { ackWait: 1_000_000_000 },
    });
    adapter = js;
    await js.connect();

    let attempts = 0;
    const parked: Array<Message<{ n: number }>> = [];

    await js.subscribe<{ n: number }>(dlqSubject, async (message) => {
      parked.push(message);
      await message.ack();
    }, { group: 'itest-dlq-reader', ackMode: 'manual' });

    await js.subscribe('dlqsrc.one', async () => {
      attempts += 1;
      throw new Error('always fails');
    }, { group: 'itest-dlq', deadLetter: { queue: dlqSubject, maxRetries: 2 } });

    await js.publish('dlqsrc.one', { n: 7 });

    await pollUntil(() => parked.length === 1);

    expect(parked[0].data).toEqual({ n: 7 });
    expect(parked[0].metadata['dlq.originalPattern']).toBe('dlqsrc.one');
    expect(parked[0].metadata['dlq.deliveryCount']).toBe(2);

    // Terminated, not left to be exhausted: the handler must not run a third time even
    // after several ack_wait windows have passed.
    const seen = attempts;
    await new Promise((resolve) => setTimeout(resolve, 3_000));

    expect(attempts).toBe(seen);
    expect(attempts).toBe(2);
  }, CASE_TIMEOUT_MS);

  it('does not redeliver a message whose handler was still running at disconnect', async () => {
    // The regression only a real broker can show: the ack of an abandoned handler is
    // published onto a closed connection, buffered and dropped without throwing, and the
    // server redelivers after ack_wait. `ack_wait` is pinned to 1s so the redelivery
    // window closes inside the case instead of 30s later.
    const streamName = 'ITEST_DRAIN';
    const group = 'itest-drain';
    const ackWaitNs = 1_000_000_000;

    const first = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [{ name: streamName, subjects: ['drain.>'] }],
      consumerConfig: { ackWait: ackWaitNs },
    });
    adapter = first;
    await first.connect();

    let started = false;
    let acked = false;

    await first.subscribe('drain.one', async (message) => {
      started = true;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await message.ack();
      acked = true;
    }, { group, ackMode: 'manual' });

    await first.publish('drain.one', { n: 1 });
    await pollUntil(() => started);

    // Mid-flight by construction: the handler is 300ms long and has only just begun.
    await first.disconnect();

    expect(acked).toBe(true);

    // A second instance binds the SAME durable — the name is derived from group and
    // pattern — so anything the server still considers unacknowledged lands here.
    const second = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [{ name: streamName, subjects: ['drain.>'] }],
      consumerConfig: { ackWait: ackWaitNs },
    });
    adapter = second;

    try {
      await second.connect();

      const redelivered: unknown[] = [];
      await second.subscribe('drain.one', async (message) => {
        redelivered.push(message.data);
        await message.ack();
      }, { group, ackMode: 'manual' });

      // Three ack_wait windows: a lost ack would have redelivered in the first.
      await new Promise((resolve) => setTimeout(resolve, 3_000));

      expect(redelivered).toHaveLength(0);
    } finally {
      if (second.isConnected()) {
        await second.disconnect();
      }
    }
  }, CASE_TIMEOUT_MS);
  it('accepts any filter_subject, however unrelated to what the stream binds', async () => {
    // OQ-B, and the reason strict local resolution is the only defence there is.
    //
    // The question asked was whether nats-server requires `filter_subject` to be a SUBSET of the
    // stream's subjects, or merely to overlap them. The measured answer is neither: it checks
    // nothing at all. A filter completely disjoint from the stream is accepted, stored verbatim,
    // and its consumer sits at `num_pending: 0` forever — a subscription that is alive, healthy
    // and permanently empty, with nothing logged on either side.
    //
    // Two things follow. The overlap pass in `resolveStreamForSubject` is legitimate, because
    // `events.*` really does deliver against a stream declared `['events.created', ...]`. And the
    // enriched `consumers.add` failure message can never fire for a mis-bound subscription, so
    // the declared stream set is the whole oracle. This test is the evidence for both.
    const js = makeAdapter('ITEST_FILTER', ['filter.created', 'filter.updated']);
    await js.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsm = (js as any).jsm as AnyRecord;

    const add = async (durable: string, filterSubject: string): Promise<string | null> => {
      try {
        await jsm.consumers.add('ITEST_FILTER', {
           
          durable_name: durable,
           
          ack_policy: AckPolicy.Explicit,
           
          filter_subject: filterSubject,
        });

        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };

    expect({
      subset: await add('oqb_subset', 'filter.created'),
      overlapping: await add('oqb_overlap', 'filter.*'),
      broader: await add('oqb_broad', 'filter.>'),
      universal: await add('oqb_universal', '>'),
      // The one that matters: nothing this stream will ever hold matches it.
      disjoint: await add('oqb_disjoint', 'nothing.to.do.with.this.stream'),
    }).toEqual({
      subset: null,
      overlapping: null,
      broader: null,
      universal: null,
      disjoint: null,
    });

    // Accepted AND dead: published messages reach the overlapping consumer and never the
    // disjoint one. Without this half, "accepted" would not distinguish a server that quietly
    // rewrote the filter from one that honoured it.
    await js.publish('filter.created', { n: 1 });
    await js.publish('filter.updated', { n: 2 });

    await pollUntil(async () => {
      const overlapping = await jsm.consumers.info('ITEST_FILTER', 'oqb_overlap');

      return overlapping.num_pending === 2;
    });

    const disjoint = await jsm.consumers.info('ITEST_FILTER', 'oqb_disjoint');

    expect({
      storedFilter: disjoint.config.filter_subject,
      pending: disjoint.num_pending,
    }).toEqual({
      storedFilter: 'nothing.to.do.with.this.stream',
      pending: 0,
    });
  }, CASE_TIMEOUT_MS);

  it('lets a unit that declares nothing publish into a stream someone else owns', async () => {
    // The shape a deployed producer has: the worker owns the stream, the api/intake units only
    // publish into it. They used to be forced to declare it — the constructor refused an empty
    // list — and then the reconcile pass tried to create or update a stream that was not theirs.
    const owner = makeAdapter('ITEST_OWNED', ['owned.>']);
    await owner.connect();

    const received: Array<Message<{ n: number }>> = [];
    await owner.subscribe<{ n: number }>('owned.created', async (message) => {
      received.push(message);
      await message.ack();
    }, { ackMode: 'manual', group: 'itest-owned-workers' });

    const producer = new JetStreamQueueAdapter({ servers: nats.url });
    try {
      await producer.connect();
      await producer.publish('owned.created', { n: 7 });

      await pollUntil(() => received.length === 1);

      expect(received[0].data.n).toBe(7);
    } finally {
      if (producer.isConnected()) {
        await producer.disconnect();
      }
    }
  }, CASE_TIMEOUT_MS);

  it('leaves an unmanaged stream exactly as its owner configured it', async () => {
    // `manage: false` declares the stream for subscription resolution and nothing else. Without
    // it the declaration carries no OneBun stamp, `decideStamp` answers `update`, and connecting
    // rewrites a configuration this application does not own — which on a tenant-scoped broker
    // is a permissions failure at boot and on a permissive one is a silent overwrite.
    const owner = makeAdapter('ITEST_FOREIGN', ['foreign.>']);
    await owner.connect();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownerJsm = (owner as any).jsm as AnyRecord;
    await ownerJsm.streams.update('ITEST_FOREIGN', {
      subjects: ['foreign.>'],

      max_msgs: 4242,
      metadata: {},
    });

    const before = await ownerJsm.streams.info('ITEST_FOREIGN');

    const guest = new JetStreamQueueAdapter({
      servers: nats.url,
      // A declaration that WOULD change the stream if it were reconciled.
      streams: [{
        name: 'ITEST_FOREIGN', subjects: ['foreign.>'], maxMsgs: 1, manage: false, 
      }],
    });

    try {
      await guest.connect();

      const after = await ownerJsm.streams.info('ITEST_FOREIGN');

      expect(after.config.max_msgs).toBe(4242);
      expect(after.config.metadata ?? {}).toEqual(before.config.metadata ?? {});

      // Still resolvable: the declaration does its other job.
      expect(guest.resolveStreamForSubject('foreign.created')).toBe('ITEST_FOREIGN');
    } finally {
      if (guest.isConnected()) {
        await guest.disconnect();
      }
    }
  }, CASE_TIMEOUT_MS);

  it('subscribes to an unmanaged stream, building the JetStream manager on demand', async () => {
    // The lazy-manager path end to end. Every other case here declares a MANAGED stream, so
    // `ensureAllStreams()` builds the manager during connect() and the consumer path then finds
    // it already there — `this.jsm!` would still work in all of them. Here nothing is managed, so
    // connect() leaves it unbuilt and `subscribe()` is the first caller that needs one.
    const owner = makeAdapter('ITEST_LAZY', ['lazy.>']);
    await owner.connect();

    const guest = new JetStreamQueueAdapter({
      servers: nats.url,
      manageStreams: false,
      streams: [{ name: 'ITEST_LAZY', subjects: ['lazy.>'] }],
    });

    try {
      await guest.connect();

      expect(asAny(guest).jsm).toBeNull();

      const received: Array<Message<{ n: number }>> = [];
      await guest.subscribe<{ n: number }>('lazy.created', async (message) => {
        received.push(message);
        await message.ack();
      }, { ackMode: 'manual', group: 'itest-lazy-workers' });

      expect(asAny(guest).jsm).not.toBeNull();

      await owner.publish('lazy.created', { n: 11 });
      await pollUntil(() => received.length === 1);

      expect(received[0].data.n).toBe(11);
    } finally {
      if (guest.isConnected()) {
        await guest.disconnect();
      }
    }
  }, CASE_TIMEOUT_MS);

  it('closes the connection when connect() fails after opening it', async () => {
    // A single-node server refuses `replicas: 3` from stream reconciliation, which runs after the
    // socket is open and before the adapter counts itself connected. `disconnect()` returns early
    // for an adapter that never connected, so this connection used to stay open with nothing able
    // to close it — a process that caught the error never exited.
    const js = new JetStreamQueueAdapter({
      servers: nats.url,
      streams: [{ name: 'ITEST_REPLICAS', subjects: ['replicas.>'], replicas: 3 }],
    });
    adapter = js;

    await expect(js.connect()).rejects.toThrow('ITEST_REPLICAS');

    expect(js.isConnected()).toBe(false);
    expect(asAny(js).client.isConnected()).toBe(false);
    expect(asAny(js).js).toBeNull();
    // The rollback's own disconnect() still resolves, with nothing left to release.
    await expect(js.disconnect()).resolves.toBeUndefined();
  }, CASE_TIMEOUT_MS);

  // ==========================================================================
  // Workqueue streams (FB-30)
  //
  // Only a real server enforces the workqueue consumer rules — deliver_policy all (10101)
  // and one consumer per subject (10100) — and only a real server deletes an acknowledged
  // task. The mock harness emulates neither, which is how `deliver_policy: new` shipped
  // unconditionally with a green suite. Every case uses a stream and subjects of its own:
  // on a workqueue a leftover consumer from another case would hold the subject.
  // ==========================================================================

  describe('workqueue streams', () => {
    const opened: JetStreamQueueAdapter[] = [];

    afterEach(async () => {
      for (const created of opened.splice(0)) {
        if (created.isConnected()) {
          await created.disconnect();
        }
      }
    });

    function makeStreamAdapter(
      streamName: string,
      subjects: string[],
      retention: 'workqueue' | 'limits' | undefined = 'workqueue',
    ): JetStreamQueueAdapter {
      const created = new JetStreamQueueAdapter({
        servers: nats.url,
        streams: [{ name: streamName, subjects, retention }],
      });
      opened.push(created);

      return created;
    }

    /** Stored message count, read through an adapter that stays connected for the whole case. */
    async function storedMessages(observer: JetStreamQueueAdapter, streamName: string): Promise<number> {
      const info = await (asAny(observer).jsm as AnyRecord).streams.info(streamName);

      return info.state.messages as number;
    }

    it('delivers a task published before the first grouped subscription, and the ack deletes it', async () => {
      // The reporter's first acceptance point. Under `deliver_policy: new` the consumer could
      // not be created at all; and had the server accepted it, the task would have been skipped.
      const streamName = 'ITEST_WQ_BACKLOG';
      const group = 'itest-wq-backlog';
      const producer = makeStreamAdapter(streamName, ['wqbacklog.>']);
      await producer.connect();

      await producer.publish('wqbacklog.run', { id: 'before-subscribe' });
      expect(await storedMessages(producer, streamName)).toBe(1);

      const worker = makeStreamAdapter(streamName, ['wqbacklog.>']);
      await worker.connect();

      const received: string[] = [];
      await worker.subscribe<{ id: string }>('wqbacklog.run', async (message) => {
        received.push(message.data.id);
        await message.ack();
      }, { group, ackMode: 'manual' });

      await pollUntil(() => received.length === 1);
      expect(received).toEqual(['before-subscribe']);

      // Workqueue retention: the acknowledgement removed the task from the stream.
      await pollUntil(async () => await storedMessages(producer, streamName) === 0);
      expect(await storedMessages(producer, streamName)).toBe(0);

      const consumer = await (asAny(producer).jsm as AnyRecord).consumers.info(
        streamName,
        durableNameFor(group, 'wqbacklog.run'),
      );
      expect(consumer.config.deliver_policy).toBe(DeliverPolicy.All);
    }, CASE_TIMEOUT_MS);

    it('hands a data-less task to its worker, and only the acknowledgement deletes it', async () => {
      // `publish(topic, undefined)` on a workqueue: a termination there deletes the task before any
      // handler sees it, so the task must still be stored while its handler runs.
      const streamName = 'ITEST_WQ_NODATA';
      const group = 'itest-wq-nodata';
      const producer = makeStreamAdapter(streamName, ['wqnodata.>']);
      await producer.connect();

      await producer.publish('wqnodata.run', undefined);
      expect(await storedMessages(producer, streamName)).toBe(1);

      const worker = makeStreamAdapter(streamName, ['wqnodata.>']);
      await worker.connect();

      const errors: Error[] = [];
      worker.on('onError', (error) => {
        errors.push(error);
      });

      const received: Array<Message<unknown>> = [];
      let storedWhileHandling = -1;
      await worker.subscribe('wqnodata.run', async (message) => {
        storedWhileHandling = await storedMessages(producer, streamName);
        received.push(message);
        await message.ack();
      }, { group, ackMode: 'manual' });

      await pollUntil(() => received.length === 1);
      expect(storedWhileHandling).toBe(1);
      expect(received[0].data).toBeUndefined();

      await pollUntil(async () => await storedMessages(producer, streamName) === 0);
      expect(errors).toEqual([]);
    }, CASE_TIMEOUT_MS);

    it('hands a restarted worker of the same group what was published while it was offline', async () => {
      const streamName = 'ITEST_WQ_OFFLINE';
      const group = 'itest-wq-offline';
      const producer = makeStreamAdapter(streamName, ['wqoffline.>']);
      await producer.connect();

      const first = makeStreamAdapter(streamName, ['wqoffline.>']);
      await first.connect();
      await first.subscribe('wqoffline.run', async (message) => {
        await message.ack();
      }, { group, ackMode: 'manual' });
      await first.disconnect();

      for (const id of ['off-1', 'off-2', 'off-3']) {
        await producer.publish('wqoffline.run', { id });
      }
      expect(await storedMessages(producer, streamName)).toBe(3);

      const restarted = makeStreamAdapter(streamName, ['wqoffline.>']);
      await restarted.connect();

      const received: string[] = [];
      await restarted.subscribe<{ id: string }>('wqoffline.run', async (message) => {
        received.push(message.data.id);
        await message.ack();
      }, { group, ackMode: 'manual' });

      await pollUntil(() => received.length === 3);
      expect([...received].sort()).toEqual(['off-1', 'off-2', 'off-3']);

      await pollUntil(async () => await storedMessages(producer, streamName) === 0);
      expect(await storedMessages(producer, streamName)).toBe(0);
    }, CASE_TIMEOUT_MS);

    it('splits the tasks between replicas of one group, each exactly once', async () => {
      // Sequential on purpose: this case is about the workqueue sharing one durable between
      // replicas. Replicas that start at the same instant race on the create (10148); that race
      // has its own cases under "replicas booting at the same time".
      const streamName = 'ITEST_WQ_REPLICAS';
      const group = 'itest-wq-replicas';
      const total = 20;
      const producer = makeStreamAdapter(streamName, ['wqreplicas.>']);
      await producer.connect();

      const received: string[] = [];
      const replica = async (): Promise<void> => {
        const created = makeStreamAdapter(streamName, ['wqreplicas.>']);
        await created.connect();
        await created.subscribe<{ id: string }>('wqreplicas.run', async (message) => {
          received.push(message.data.id);
          await message.ack();
        }, { group, ackMode: 'manual' });
      };

      await replica();
      await replica();

      for (let n = 0; n < total; n += 1) {
        await producer.publish('wqreplicas.run', { id: `task-${n}` });
      }

      await pollUntil(() => received.length >= total);
      await pollUntil(async () => await storedMessages(producer, streamName) === 0);

      expect(received).toHaveLength(total);
      expect(new Set(received).size).toBe(total);
    }, CASE_TIMEOUT_MS);

    it('refuses a second group on the same subject with the one-consumer-per-subject message', async () => {
      const streamName = 'ITEST_WQ_UNIQUE';
      const worker = makeStreamAdapter(streamName, ['wqunique.>']);
      await worker.connect();
      await worker.subscribe('wqunique.run', async () => undefined, { group: 'itest-wq-first' });

      const attempt = async (on: JetStreamQueueAdapter, group: string): Promise<Error> => {
        try {
          await on.subscribe('wqunique.run', async () => undefined, { group });
        } catch (error) {
          return error as Error;
        }

        throw new Error(`a second group "${group}" was accepted on a workqueue subject`);
      };

      // In the same application: the message names the subscription that holds the subject.
      const inProcess = await attempt(worker, 'itest-wq-second');
      expect(inProcess.message).toContain('one consumer per subject');
      expect(inProcess.message).toContain('"wqunique.run" (group "itest-wq-first")');
      expect(inProcess.message).toContain('group "itest-wq-second"');
      expect((inProcess.cause as AnyRecord).code).toBe(10_100);

      // From another process: nothing local overlaps, so the message points at a stale durable.
      const elsewhere = makeStreamAdapter(streamName, ['wqunique.>']);
      await elsewhere.connect();
      const outOfProcess = await attempt(elsewhere, 'itest-wq-third');
      expect(outOfProcess.message).toContain('one consumer per subject');
      expect(outOfProcess.message).toContain('deleteDurableConsumer');
    }, CASE_TIMEOUT_MS);

    it('names the missing declaration when the server holds a workqueue the application does not declare', async () => {
      const streamName = 'ITEST_WQ_UNDECLARED';
      const owner = makeStreamAdapter(streamName, ['wqundeclared.>']);
      await owner.connect();

      // Declared for resolution only, with no retention: the policy falls back to `new`.
      const guest = new JetStreamQueueAdapter({
        servers: nats.url,
        streams: [{ name: streamName, subjects: ['wqundeclared.>'], manage: false }],
      });
      opened.push(guest);
      await guest.connect();

      let thrown: Error | undefined;
      try {
        await guest.subscribe('wqundeclared.run', async () => undefined, { group: 'itest-wq-guest' });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown!.message).toContain("retention: 'workqueue'");
      expect(thrown!.message).toContain(`"${streamName}"`);
      expect((thrown!.cause as AnyRecord).code).toBe(10_101);
    }, CASE_TIMEOUT_MS);

    it('still starts a new durable on a limits stream at the subscription, not at the backlog', async () => {
      // The other half of the rule: `all` is for workqueues only. A limits stream keeps what
      // was published before the durable existed, and a new durable must not replay it.
      const streamName = 'ITEST_WQ_LIMITS';
      const producer = makeStreamAdapter(streamName, ['wqlimits.>'], 'limits');
      await producer.connect();

      await producer.publish('wqlimits.run', { id: 'before-subscribe' });

      const worker = makeStreamAdapter(streamName, ['wqlimits.>'], 'limits');
      await worker.connect();

      const received: string[] = [];
      await worker.subscribe<{ id: string }>('wqlimits.run', async (message) => {
        received.push(message.data.id);
        await message.ack();
      }, { group: 'itest-wq-limits', ackMode: 'manual' });

      await producer.publish('wqlimits.run', { id: 'after-subscribe' });

      // Delivery is in stream order, so a replayed 'before-subscribe' would arrive first.
      await pollUntil(() => received.includes('after-subscribe'));
      expect(received).toEqual(['after-subscribe']);
      // And a limits stream keeps both after the ack.
      expect(await storedMessages(producer, streamName)).toBe(2);
    }, CASE_TIMEOUT_MS);
  });

  describe('native NATS wildcards in a subscription pattern', () => {
    const opened: JetStreamQueueAdapter[] = [];

    afterEach(async () => {
      for (const created of opened.splice(0)) {
        if (created.isConnected()) {
          await created.disconnect();
        }
      }
    });

    function makeStreamAdapter(
      streamName: string,
      subjects: string[],
      retention: 'workqueue' | 'limits',
    ): JetStreamQueueAdapter {
      const created = new JetStreamQueueAdapter({
        servers: nats.url,
        streams: [{ name: streamName, subjects, retention }],
      });
      opened.push(created);

      return created;
    }

    async function storedMessages(observer: JetStreamQueueAdapter, streamName: string): Promise<number> {
      const info = await (asAny(observer).jsm as AnyRecord).streams.info(streamName);

      return info.state.messages as number;
    }

    async function consumerFilters(observer: JetStreamQueueAdapter, streamName: string): Promise<string[]> {
      const filters: string[] = [];
      for await (const info of await (asAny(observer).jsm as AnyRecord).consumers.list(streamName)) {
        filters.push(info.config.filter_subject as string);
      }

      return filters;
    }

    for (const retention of ['limits', 'workqueue'] as const) {
      const tag = retention === 'limits' ? 'L' : 'W';

      it(`delivers every message a ">" pattern covers to the handler on a ${retention} stream`, async () => {
        const streamName = `ITEST_NATIVE_GT_${tag}`;
        const root = `nativegt${tag}`;
        const worker = makeStreamAdapter(streamName, [`${root}.>`], retention);
        await worker.connect();

        const received: Array<Message<{ n: number }>> = [];
        const storedWhileHandling: number[] = [];
        await worker.subscribe<{ n: number }>(`${root}.>`, async (message) => {
          storedWhileHandling.push(await storedMessages(worker, streamName));
          received.push(message);
          await message.ack();
        }, { group: `itest-native-gt-${tag}`, ackMode: 'manual' });

        await worker.publish(`${root}.a`, { n: 1 });
        await worker.publish(`${root}.a.b`, { n: 2 });

        await pollUntil(() => received.length === 2);
        expect(received.map(message => message.subject).sort()).toEqual([`${root}.a`, `${root}.a.b`]);
        // A native wildcard names nothing, so it captures nothing.
        expect(received.map(message => message.params)).toEqual([{}, {}]);
        // The filter the server applies is the pattern itself.
        expect(await consumerFilters(worker, streamName)).toEqual([`${root}.>`]);

        if (retention === 'workqueue') {
          // Each task was still stored while its handler ran: only the handler's ack deleted it.
          expect(storedWhileHandling.every(count => count >= 1)).toBe(true);
          await pollUntil(async () => await storedMessages(worker, streamName) === 0);
        } else {
          expect(await storedMessages(worker, streamName)).toBe(2);
        }
      }, CASE_TIMEOUT_MS);

      it(`delivers one token to a "*" pattern and leaves deeper subjects alone on a ${retention} stream`, async () => {
        const streamName = `ITEST_NATIVE_STAR_${tag}`;
        const root = `nativestar${tag}`;
        const worker = makeStreamAdapter(streamName, [`${root}.>`], retention);
        await worker.connect();

        const received: Array<Message<{ n: number }>> = [];
        await worker.subscribe<{ n: number }>(`${root}.*`, async (message) => {
          received.push(message);
          await message.ack();
        }, { group: `itest-native-star-${tag}`, ackMode: 'manual' });

        await worker.publish(`${root}.a.b`, { n: 2 });
        await worker.publish(`${root}.a`, { n: 1 });

        await pollUntil(() => received.length === 1);
        expect(received[0].subject).toBe(`${root}.a`);
        expect(received[0].params).toEqual({});

        // The deeper subject was never this consumer's: on a workqueue it is still waiting.
        await pollUntil(async () => await storedMessages(worker, streamName) === (retention === 'workqueue' ? 1 : 2));
        expect(received).toHaveLength(1);
      }, CASE_TIMEOUT_MS);
    }

    it('delivers to a ">"-only pattern every subject the stream binds', async () => {
      const streamName = 'ITEST_NATIVE_ALL';
      const worker = makeStreamAdapter(streamName, ['nativeall.>'], 'workqueue');
      await worker.connect();

      const received: string[] = [];
      await worker.subscribe('>', async (message) => {
        received.push(message.subject ?? '');
      }, { group: 'itest-native-all' });

      await worker.publish('nativeall.x', { n: 1 });
      await worker.publish('nativeall.x.y', { n: 2 });

      await pollUntil(() => received.length === 2);
      expect(received.sort()).toEqual(['nativeall.x', 'nativeall.x.y']);
      await pollUntil(async () => await storedMessages(worker, streamName) === 0);
    }, CASE_TIMEOUT_MS);

    it('delivers the same subjects to ">" and "#", and the same tokens to "*" and "{name}"', async () => {
      const streamName = 'ITEST_NATIVE_PARITY';
      const worker = makeStreamAdapter(streamName, ['nativeparity.>'], 'limits');
      await worker.connect();

      const seen: Record<string, Array<{ subject?: string; params: Record<string, string> }>> = {
        native: [], framework: [], star: [], named: [],
      };
      const record = (key: string) => async (message: Message<unknown>): Promise<void> => {
        seen[key].push({ subject: message.subject, params: message.params });
      };

      await worker.subscribe('nativeparity.>', record('native'), { group: 'parity-native' });
      await worker.subscribe('nativeparity.#', record('framework'), { group: 'parity-framework' });
      await worker.subscribe('nativeparity.*', record('star'), { group: 'parity-star' });
      await worker.subscribe('nativeparity.{id}', record('named'), { group: 'parity-named' });

      await worker.publish('nativeparity.a', { n: 1 });
      await worker.publish('nativeparity.a.b', { n: 2 });

      await pollUntil(() => seen.native.length === 2 && seen.framework.length === 2
        && seen.star.length === 1 && seen.named.length === 1);

      const subjects = (key: string): string[] => seen[key].map(entry => entry.subject ?? '').sort();
      expect(subjects('native')).toEqual(['nativeparity.a', 'nativeparity.a.b']);
      expect(subjects('framework')).toEqual(subjects('native'));
      expect(seen.star).toEqual([{ subject: 'nativeparity.a', params: {} }]);
      expect(seen.named).toEqual([{ subject: 'nativeparity.a', params: { id: 'a' } }]);
    }, CASE_TIMEOUT_MS);

    it('gives ">" and "#" in one group a single durable, as the same pattern twice would be', async () => {
      const streamName = 'ITEST_NATIVE_DURABLE';
      const worker = makeStreamAdapter(streamName, ['nativedurable.>'], 'workqueue');
      await worker.connect();

      await worker.subscribe('nativedurable.>', async () => undefined, { group: 'itest-native-durable' });
      await worker.subscribe('nativedurable.#', async () => undefined, { group: 'itest-native-durable' });

      expect(await consumerFilters(worker, streamName)).toEqual(['nativedurable.>']);
    }, CASE_TIMEOUT_MS);

    for (const pattern of ['nativebad.>.run', '>.nativebad', 'nativebad..run', 'nativebad.', 'nativebad.new run']) {
      it(`refuses "${pattern}", which can never receive a message, at subscribe(), naming it, and creates no consumer`, async () => {
        const streamName = 'ITEST_NATIVE_INVALID';
        const worker = makeStreamAdapter(streamName, ['nativebad.>'], 'limits');
        await worker.connect();

        let thrown: Error | undefined;
        try {
          await worker.subscribe(pattern, async () => undefined, { group: 'itest-native-invalid' });
        } catch (error) {
          thrown = error as Error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown!.message).toContain(`"${pattern}"`);
        expect(await consumerFilters(worker, streamName)).toEqual([]);
      }, CASE_TIMEOUT_MS);
    }

    /** A parameter name may hold whitespace: the name never reaches the wire, which carries `*`. */
    for (const { retention, cases } of [
      {
        retention: 'limits' as const,
        cases: [
          {
            pattern: 'wsL.p.{a b}', group: 'itest-ws', publish: ['wsL.p.a'], delivered: 'wsL.p.a', params: { [SPACED_NAME]: 'a' },
          },
          {
            pattern: 'wsL.r.{a b}', group: undefined, publish: ['wsL.r.a'], delivered: 'wsL.r.a', params: { [SPACED_NAME]: 'a' },
          },
          {
            pattern: 'wsL.q.v{a b}', group: 'itest-ws', publish: ['wsL.q.x', 'wsL.q.v1'], delivered: 'wsL.q.v1', params: { [SPACED_NAME]: '1' },
          },
        ],
      },
      {
        retention: 'workqueue' as const,
        cases: [
          {
            pattern: 'wsW.p.{a b}', group: 'itest-ws', publish: ['wsW.p.a'], delivered: 'wsW.p.a', params: { [SPACED_NAME]: 'a' },
          },
        ],
      },
    ]) {
      const root = retention === 'limits' ? 'wsL' : 'wsW';

      for (const {
        pattern, group, publish, delivered, params,
      } of cases) {
        it(`delivers to "${pattern}"${group ? '' : ' without a group'} on a ${retention} stream, capturing into the spaced name`, async () => {
          const streamName = `ITEST_WS_${retention.toUpperCase()}`;
          const worker = makeStreamAdapter(streamName, [`${root}.>`], retention);
          await worker.connect();

          const received: Array<{ subject?: string; params: Record<string, string> }> = [];
          await worker.subscribe(pattern, async (message) => {
            received.push({ subject: message.subject, params: message.params });
          }, group === undefined ? undefined : { group });

          for (const subject of publish) {
            await worker.publish(subject, { subject });
          }

          await pollUntil(() => received.length >= 1);
          expect(received).toEqual([{ subject: delivered, params }]);
        }, CASE_TIMEOUT_MS);
      }
    }

    it('refuses the partial-token "wsW.q.v{a b}" on a workqueue stream, as any partial-token pattern', async () => {
      const worker = makeStreamAdapter('ITEST_WS_WORKQUEUE', ['wsW.>'], 'workqueue');
      await worker.connect();

      let thrown: Error | undefined;
      try {
        await worker.subscribe('wsW.q.v{a b}', async () => undefined, { group: 'itest-ws' });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown?.message).toMatch(/partial-token/);
    }, CASE_TIMEOUT_MS);

    /**
     * A wildcard glued into a token is a literal token on the server: the subscription receives the
     * one subject it spells, and none of the subjects the in-process matcher's sub-token `*` would
     * also accept. A `{name}` beside it widens the filter to `*` and narrows back in process.
     */
    const glued: Array<{ tail: string; delivered: string; params: Record<string, string>; neighbours: string[] }> = [
      {
        tail: 'a*b', delivered: 'a*b', params: {}, neighbours: ['aqb'],
      },
      {
        tail: 'v*', delivered: 'v*', params: {}, neighbours: ['v1'],
      },
      {
        tail: '*a', delivered: '*a', params: {}, neighbours: ['ba'],
      },
      {
        tail: '**', delivered: '**', params: {}, neighbours: ['ab'],
      },
      {
        tail: 'foo>', delivered: 'foo>', params: {}, neighbours: ['fooz'],
      },
      {
        tail: 'a>b', delivered: 'a>b', params: {}, neighbours: ['ab'],
      },
      {
        tail: '>>', delivered: '>>', params: {}, neighbours: ['a'],
      },
      {
        tail: '{id}>', delivered: '1>', params: { id: '1' }, neighbours: ['1'],
      },
    ];

    for (const retention of ['limits', 'workqueue'] as const) {
      const tag = retention === 'limits' ? 'L' : 'W';

      glued.forEach(({
        tail, delivered, params, neighbours,
      }, index) => {
        const root = `glued${tag}.${index}`;
        const widens = tail.includes('{');

        if (retention === 'workqueue' && widens) {
          it(`refuses the partial-token "${root}.${tail}" on a workqueue stream`, async () => {
            const worker = makeStreamAdapter(`ITEST_GLUED_${tag}`, [`glued${tag}.>`], retention);
            await worker.connect();

            let thrown: Error | undefined;
            try {
              await worker.subscribe(`${root}.${tail}`, async () => undefined, { group: 'itest-glued' });
            } catch (error) {
              thrown = error as Error;
            }

            expect(thrown?.message).toMatch(/partial-token/);
          }, CASE_TIMEOUT_MS);

          return;
        }

        it(`delivers to "${root}.${tail}" the literal subject "${root}.${delivered}" on a ${retention} stream`, async () => {
          const streamName = `ITEST_GLUED_${tag}`;
          const worker = makeStreamAdapter(streamName, [`glued${tag}.>`], retention);
          await worker.connect();

          const received: Array<{ subject?: string; params: Record<string, string> }> = [];
          await worker.subscribe(`${root}.${tail}`, async (message) => {
            received.push({ subject: message.subject, params: message.params });
          }, { group: 'itest-glued' });

          expect(await consumerFilters(worker, streamName))
            .toContain(widens ? `${root}.*` : `${root}.${tail}`);

          for (const neighbour of neighbours) {
            await worker.publish(`${root}.${neighbour}`, { neighbour });
          }
          await worker.publish(`${root}.${delivered}`, { delivered });

          // Stream order: once the subject published last is in, every earlier one was decided.
          await pollUntil(() => received.length >= 1);
          expect(received).toEqual([{ subject: `${root}.${delivered}`, params }]);
        }, CASE_TIMEOUT_MS);
      });
    }
  });

  describe('replicas booting at the same time', () => {
    // The race is timing-dependent: two released 0.8.1 adapters lost it in about 3 rounds of 10.
    // Every round runs on a stream no earlier round touched, so each one starts from absence and
    // both replicas miss the probe before either creates.
    const ROUNDS = 10;
    const REPLICAS = 2;
    const opened: JetStreamQueueAdapter[] = [];

    afterEach(async () => {
      for (const created of opened.splice(0)) {
        if (created.isConnected()) {
          await created.disconnect();
        }
      }
    });

    async function consumerNames(observer: JetStreamQueueAdapter, streamName: string): Promise<string[]> {
      const names: string[] = [];
      for await (const info of await (asAny(observer).jsm as AnyRecord).consumers.list(streamName)) {
        names.push(info.name);
      }

      return names;
    }

    for (const retention of ['limits', 'workqueue'] as const) {
      it(`starts every replica of one (group, pattern) on a ${retention} stream, round after round`, async () => {
        const group = `itest-race-${retention}`;
        const rejections: string[] = [];

        for (let round = 0; round < ROUNDS; round += 1) {
          const streamName = `ITEST_RACE_${retention.toUpperCase()}_${round}`;
          const pattern = `race${retention}${round}.run`;
          const replicas = Array.from({ length: REPLICAS }, () => {
            const created = new JetStreamQueueAdapter({
              servers: nats.url,
              streams: [{ name: streamName, subjects: [`race${retention}${round}.>`], retention }],
            });
            opened.push(created);

            return created;
          });

          // Connected at once as well: a first rollout finds no stream either, and the stream
          // create races the same way, refused with 10058 "stream name already in use".
          await Promise.all(replicas.map(async (replica) => await replica.connect()));

          const results = await Promise.allSettled(replicas.map(async (replica) =>
            await replica.subscribe(pattern, async () => undefined, { group })));

          for (const result of results) {
            if (result.status === 'rejected') {
              rejections.push(`round ${round}: ${(result.reason as Error).message}`);
            }
          }

          // One durable, shared by both: the replica that lost the create adopted its peer's consumer.
          expect(await consumerNames(replicas[0], streamName)).toEqual([durableNameFor(group, pattern)]);

          for (const replica of replicas) {
            await replica.disconnect();
          }
        }

        expect(rejections).toEqual([]);
      }, CASE_TIMEOUT_MS);
    }
  });
});
