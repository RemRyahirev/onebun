/**
 * JetStream Queue Adapter Integration Tests
 *
 * Runs against a real nats-server with JetStream enabled, started via
 * testcontainers. Unconditional by design — no env gate and no skip, matching
 * the convention in `nats.adapter.integration.test.ts`.
 */

import { AckPolicy } from '@nats-io/jetstream';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';


import type { Message } from '@onebun/core';
import { matchQueuePattern } from '@onebun/core';
import { createNatsContainer, type TestContainer } from '@onebun/core/testing';

import { hashReconcileConfig } from '../src/config-stamp';
import { JetStreamQueueAdapter } from '../src/jetstream.adapter';
import { toNatsSubject } from '../src/subject';

/** Mirrors the adapter's durable naming so the test does not hardcode a digest. */
function durableNameFor(group: string, pattern: string): string {
  const subject = toNatsSubject(pattern);
  const sanitize = (value: string): string => value.replace(/[^-\w]/g, '_');

  return `${sanitize(group)}--${sanitize(subject)}--${hashReconcileConfig({ group, subject }).slice(0, 12)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const CONTAINER_BOOT_MS = 120_000;
const CASE_TIMEOUT_MS = 30_000;
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
    // The transport widened to `params.*`; the parameter value survives in the
    // delivered pattern and the in-process matcher recovers it.
    expect(matchQueuePattern('params.{id}', received[0].pattern).params.id).toBe('123');
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
    const names: string[] = [];
    for await (const info of await probeJsm.consumers.list('ITEST_RELEASE')) {
      names.push(info.name);
    }

    // The durable survives; the ephemeral does not.
    expect(names).toEqual([durable]);
    expect((await probeJsm.consumers.info('ITEST_RELEASE', durable)).ack_floor.stream_seq)
      .toBe(ackFloorBefore);

    // And the preserved floor is observable: re-subscribing must not replay what the
    // previous instance already acknowledged.
    const replayed: unknown[] = [];
    await probe.subscribe('release.durable', async (message) => {
      replayed.push(message.data);
      await message.ack();
    }, { group, ackMode: 'manual' });

    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(replayed).toHaveLength(0);
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
});
