/**
 * A failed publish, provoked for real
 *
 * Every reason `QueuePublishError` reports is produced here on a live nats-server, by the failure
 * it stands for, and the driver's own error is checked as the cause. The server runs under a small
 * shell supervisor so it can be frozen (SIGSTOP), resumed and stopped without losing the container
 * or its port mapping, and with a configuration that denies one subject, so a permission refusal
 * is real too.
 */

import { DiscardPolicy } from '@nats-io/jetstream';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';

import { QueuePublishError } from '@onebun/core';

import { JetStreamQueueAdapter } from '../src/jetstream.adapter';
import { NatsQueueAdapter } from '../src/nats.adapter';

const CONTAINER_BOOT_MS = 120_000;
const CASE_TIMEOUT_MS = 30_000;
const NATS_PORT = 4222;
/** Above the 1 MiB `max_payload` nats-server announces by default. */
const OVERSIZED_LENGTH = 1_100_000;

const SERVER_CONFIG = `
jetstream { store_dir: /tmp/js }
authorization {
  users = [
    { user: app, password: pw, permissions: { publish: { deny: ["pfdenied.>"] } } }
    { user: noinbox, password: pw, permissions: { subscribe: { deny: ["_INBOX.>"] } } }
  ]
}
`;

/**
 * Restarts nats-server whenever it exits, unless `/tmp/hold` exists. nats-server is a child of the
 * shell rather than PID 1, which is what lets SIGSTOP freeze it: a container's PID 1 ignores it.
 */
const SUPERVISOR = [
  'trap \'kill -TERM "$child" 2>/dev/null; exit 0\' TERM',
  'while :; do',
  '  if [ -e /tmp/hold ]; then sleep 0.1; continue; fi',
  '  nats-server -c /etc/onebun-pf.conf & child=$!',
  '  wait "$child"',
  'done',
].join('\n');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function asAny(obj: unknown): AnyRecord {
  return obj as AnyRecord;
}

/** The rejection of `publish()`, which every case here expects to be a QueuePublishError. */
async function publishFailure(publish: () => Promise<unknown>): Promise<QueuePublishError> {
  const thrown = await publish().then(
    () => new Error('publish() resolved'),
    (error: unknown) => error,
  );

  expect(thrown).toBeInstanceOf(QueuePublishError);

  return thrown as QueuePublishError;
}

/** The `name` of every error on a `cause` chain, outermost first. */
function causeNames(error: unknown): string[] {
  const names: string[] = [];

  for (let current = error; current instanceof Error; current = current.cause) {
    names.push(current.name);
  }

  return names;
}

describe('a failed publish against a live nats-server', () => {
  let container: StartedTestContainer;
  let servers: string;
  const adapters: Array<JetStreamQueueAdapter | NatsQueueAdapter> = [];

  async function sh(command: string): Promise<void> {
    const result = await container.exec(['sh', '-c', command]);

    if (result.exitCode !== 0) {
      throw new Error(`"${command}" exited with ${result.exitCode}: ${result.output}`);
    }
  }

  async function jetStream(streams = [{ name: 'PF', subjects: ['pf.>'] }]): Promise<JetStreamQueueAdapter> {
    const adapter = new JetStreamQueueAdapter({
      servers,
      user: 'app',
      pass: 'pw',
      streams,
    });
    adapters.push(adapter);
    await adapter.connect();

    return adapter;
  }

  async function coreNats(): Promise<NatsQueueAdapter> {
    const adapter = new NatsQueueAdapter({ servers, user: 'app', pass: 'pw' });
    adapters.push(adapter);
    await adapter.connect();

    return adapter;
  }

  beforeAll(async () => {
    container = await new GenericContainer('nats:2.10-alpine')
      .withEntrypoint(['/bin/sh', '-c'])
      .withCommand([SUPERVISOR])
      .withCopyContentToContainer([{ content: SERVER_CONFIG, target: '/etc/onebun-pf.conf' }])
      .withExposedPorts(NATS_PORT)
      .withWaitStrategy(Wait.forLogMessage(/Server is ready/))
      .withStartupTimeout(CONTAINER_BOOT_MS)
      .start();
    servers = `nats://${container.getHost()}:${container.getMappedPort(NATS_PORT)}`;
  }, CONTAINER_BOOT_MS);

  afterAll(async () => {
    await container.stop({ timeout: 0 });
  }, CONTAINER_BOOT_MS);

  afterEach(async () => {
    for (const adapter of adapters.splice(0)) {
      await adapter.disconnect().catch(() => undefined);
    }
  });

  describe('JetStreamQueueAdapter', () => {
    it('is "rejected" when no stream binds the subject, and says so instead of "jetstream is not enabled"', async () => {
      const js = await jetStream();

      const error = await publishFailure(() => js.publish('pfunbound.created', { n: 1 }));

      expect(error.reason).toBe('rejected');
      expect(error.safeToRepeat).toBe(true);
      expect(error.pattern).toBe('pfunbound.created');
      expect(causeNames(error.cause)).toEqual(['JetStreamNotEnabled', 'RequestError', 'NoResponders']);
      expect(error.message).toContain('no stream on the broker binds that subject');
      expect(error.message).toContain('"PF" (pf.>)');
      expect(error.message).not.toContain('jetstream is not enabled');
    }, CASE_TIMEOUT_MS);

    it('is "rejected" when a stream limit refuses the message, naming the API error', async () => {
      const js = await jetStream();
      const jsm = await asAny(js).getJsm();
      await jsm.streams.add({
        name: 'PF_LIMITED',
        subjects: ['pflimited.>'],
        max_msgs: 1,
        discard: DiscardPolicy.New,
      });

      await js.publish('pflimited.one', { n: 1 });
      const error = await publishFailure(() => js.publish('pflimited.one', { n: 2 }));

      expect(error.reason).toBe('rejected');
      expect((error.cause as { code?: number }).code).toBe(10077);
      expect(error.message).toContain('JetStream API error 10077');
      expect(error.message).not.toContain('binds');
    }, CASE_TIMEOUT_MS);

    it('is "rejected" when the server denies this user the subject, and nothing is stored', async () => {
      const js = await jetStream([{ name: 'PF_DENIED', subjects: ['pfdenied.>'] }]);

      const error = await publishFailure(() => js.publish('pfdenied.created', { n: 1 }));

      expect(error.reason).toBe('rejected');
      expect(causeNames(error.cause)).toEqual(['RequestError', 'PermissionViolationError']);
      expect((error.cause as Error & { cause: { operation: string } }).cause.operation).toBe('publish');
      expect(error.message).toContain('does not permit this connection to publish');
      const jsm = await asAny(js).getJsm();
      expect((await jsm.streams.info('PF_DENIED')).state.messages).toBe(0);
    }, CASE_TIMEOUT_MS);

    it('is "unknown" when only the reply inbox is denied — the message is stored all the same', async () => {
      const owner = await jetStream();
      // A publish-only unit (nothing to reconcile, so connect() makes no request) whose user may
      // publish anywhere but not subscribe to the inbox its acknowledgements arrive on.
      const producer = new JetStreamQueueAdapter({
        servers,
        user: 'noinbox',
        pass: 'pw',
        streams: [],
      });
      adapters.push(producer);
      await producer.connect();

      const error = await publishFailure(() => producer.publish('pf.noinbox', { n: 1 }, { messageId: 'pf-noinbox-1' }));

      expect(error.reason).toBe('unknown');
      expect(error.safeToRepeat).toBe(false);
      expect(causeNames(error.cause)).toEqual(['RequestError', 'PermissionViolationError']);
      expect((error.cause as Error & { cause: { operation: string } }).cause.operation).toBe('subscription');
      expect(error.message).toContain('may well have been stored');
      // What makes "rejected" wrong here: the server stored the message it could not acknowledge.
      const jsm = await asAny(owner).getJsm();
      const stored = await jsm.streams.getMessage('PF', { last_by_subj: 'pf.noinbox' });
      expect(stored.header.get('Nats-Msg-Id')).toBe('pf-noinbox-1');
    }, CASE_TIMEOUT_MS);

    it('is "rejected" when the message exceeds the stream\'s max_msg_size (API error 10054)', async () => {
      const js = await jetStream();
      const jsm = await asAny(js).getJsm();
      await jsm.streams.add({ name: 'PF_SMALL', subjects: ['pfsmall.>'], max_msg_size: 16 });

      const error = await publishFailure(() => js.publish('pfsmall.one', { padding: 'x'.repeat(64) }));

      expect(error.reason).toBe('rejected');
      expect((error.cause as { code?: number }).code).toBe(10054);
      expect(error.message).toContain('JetStream API error 10054');
    }, CASE_TIMEOUT_MS);

    it('is "unavailable" while the connection drains', async () => {
      const js = await jetStream();
      const draining = asAny(js).client.getConnection().drain();

      const error = await publishFailure(() => js.publish('pf.draining', { n: 1 }));
      await draining;

      expect(error.reason).toBe('unavailable');
      expect(causeNames(error.cause)).toEqual(['DrainingConnectionError']);
    }, CASE_TIMEOUT_MS);

    it('is "rejected" when the payload exceeds the server\'s max_payload', async () => {
      const js = await jetStream();

      const error = await publishFailure(() => js.publish('pf.big', { blob: 'x'.repeat(OVERSIZED_LENGTH) }));

      expect(error.reason).toBe('rejected');
      expect(causeNames(error.cause)).toEqual(['InvalidArgumentError']);
      expect(error.message).toContain('max_payload');
    }, CASE_TIMEOUT_MS);

    it('is "unavailable" after disconnect()', async () => {
      const js = await jetStream();
      await js.disconnect();

      const error = await publishFailure(() => js.publish('pf.after', { n: 1 }));

      expect(error.reason).toBe('unavailable');
      expect(error.message).toContain('JetStreamQueueAdapter not connected');
    }, CASE_TIMEOUT_MS);

    it('is "unknown" when no acknowledgement arrives — and the message is stored after all', async () => {
      const js = await jetStream();
      // Frozen, not stopped: the publish reaches the server's socket and waits there unanswered.
      await sh('kill -STOP "$(pidof nats-server)"');

      let error: QueuePublishError;
      try {
        error = await publishFailure(() => js.publish('pf.frozen', { n: 1 }, { messageId: 'pf-frozen-1' }));
      } finally {
        await sh('kill -CONT "$(pidof nats-server)"');
      }

      expect(error.reason).toBe('unknown');
      expect(error.safeToRepeat).toBe(false);
      expect(causeNames(error.cause)).toEqual(['TimeoutError']);
      expect(error.message).toContain('may or may not have been stored');

      // What makes "unknown" the honest answer: the server stores the message once it resumes.
      const jsm = await asAny(js).getJsm();
      let stored: AnyRecord | null = null;
      for (let attempt = 0; attempt < 50 && stored === null; attempt += 1) {
        stored = await jsm.streams.getMessage('PF', { last_by_subj: 'pf.frozen' }).catch(() => null);
        if (stored === null) {
          await Bun.sleep(100);
        }
      }
      expect(stored).not.toBeNull();
      expect(stored!.header.get('Nats-Msg-Id')).toBe('pf-frozen-1');
      expect(JSON.parse(new TextDecoder().decode(stored!.data)).id).toBe('pf-frozen-1');
    }, CASE_TIMEOUT_MS);

    it('is "unknown" when the connection closes while the publish waits for its acknowledgement', async () => {
      const js = await jetStream();
      await sh('kill -STOP "$(pidof nats-server)"');

      let error: QueuePublishError;
      try {
        const pending = publishFailure(() => js.publish('pf.cut', { n: 1 }));
        await Bun.sleep(100);
        await asAny(js).client.getConnection().close();
        error = await pending;
      } finally {
        await sh('kill -CONT "$(pidof nats-server)"');
      }

      expect(error.reason).toBe('unknown');
      expect(causeNames(error.cause)).toEqual(['RequestError', 'RequestError']);
      expect(error.message).toContain('connection closed');
    }, CASE_TIMEOUT_MS);
  });

  describe('NatsQueueAdapter', () => {
    it('is "rejected" when the payload exceeds the server\'s max_payload', async () => {
      const nats = await coreNats();

      const error = await publishFailure(() => nats.publish('pf.big', { blob: 'x'.repeat(OVERSIZED_LENGTH) }));

      expect(error.reason).toBe('rejected');
      expect(causeNames(error.cause)).toEqual(['InvalidArgumentError']);
    }, CASE_TIMEOUT_MS);

    it('is "unavailable" before connect()', async () => {
      const nats = new NatsQueueAdapter({ servers, user: 'app', pass: 'pw' });

      const error = await publishFailure(() => nats.publish('pf.before', { n: 1 }));

      expect(error.reason).toBe('unavailable');
    }, CASE_TIMEOUT_MS);

    it('is "rejected" for a subject the client cannot carry', async () => {
      const nats = await coreNats();

      const error = await publishFailure(() => nats.publish('pf bad subject', { n: 1 }));

      expect(error.reason).toBe('rejected');
      expect(causeNames(error.cause)).toEqual(['InvalidSubjectError']);
    }, CASE_TIMEOUT_MS);

    it('is "rejected" for a metadata header the client cannot carry', async () => {
      const nats = await coreNats();

      // Header names as an application writes them, which are not identifiers.
      const withHeaders = (entry: [string, string]) => ({ metadata: { headers: Object.fromEntries([entry]) } });

      const badName = await publishFailure(() => nats.publish('pf.headers', { n: 1 }, withHeaders(['bad name', 'x'])));
      const badValue = await publishFailure(
        () => nats.publish('pf.headers', { n: 1 }, withHeaders(['X-Ok', 'line\r\nbreak'])),
      );

      for (const error of [badName, badValue]) {
        expect(error.reason).toBe('rejected');
        expect(causeNames(error.cause)).toEqual(['InvalidArgumentError']);
      }
    }, CASE_TIMEOUT_MS);

    it('is "unavailable" while the connection drains', async () => {
      const nats = await coreNats();
      const draining = asAny(nats).client.getConnection().drain();

      const error = await publishFailure(() => nats.publish('pf.draining', { n: 1 }));
      await draining;

      expect(error.reason).toBe('unavailable');
      expect(causeNames(error.cause)).toEqual(['DrainingConnectionError']);
    }, CASE_TIMEOUT_MS);
  });

  // Last: it stops the server for good.
  it('is "unavailable" on both adapters once the server is gone and the driver gave up reconnecting', async () => {
    const options = {
      servers,
      user: 'app',
      pass: 'pw',
      maxReconnectAttempts: 1,
      reconnectTimeWait: 50,
    };
    const js = new JetStreamQueueAdapter({ ...options, streams: [{ name: 'PF', subjects: ['pf.>'] }] });
    const nats = new NatsQueueAdapter(options);
    adapters.push(js, nats);
    await js.connect();
    await nats.connect();

    await sh('touch /tmp/hold && kill -TERM "$(pidof nats-server)"');
    await Promise.all([
      asAny(js).client.getConnection().closed(),
      asAny(nats).client.getConnection().closed(),
    ]);

    const fromJetStream = await publishFailure(() => js.publish('pf.gone', { n: 1 }));
    const fromNats = await publishFailure(() => nats.publish('pf.gone', { n: 1 }));

    for (const error of [fromJetStream, fromNats]) {
      expect(error.reason).toBe('unavailable');
      expect(error.safeToRepeat).toBe(true);
      expect(causeNames(error.cause)).toEqual(['ClosedConnectionError']);
      expect(error.message).toContain('Nothing was sent');
    }
  }, CASE_TIMEOUT_MS);
});
