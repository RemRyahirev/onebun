/**
 * NATS and JetStream Module
 *
 * Provides queue adapters for NATS pub/sub and JetStream.
 */

// Types
export type {
  NatsConnectionOptions,
  NatsAdapterOptions,
  JetStreamAdapterOptions,
} from './types';

// NATS Client
export {
  NatsClient,
  createNatsClient,
  type NatsMessage,
  type NatsSubscriptionHandle,
} from './nats-client';

// NATS Queue Adapter (pub/sub)
export { NatsQueueAdapter, createNatsQueueAdapter } from './nats.adapter';

// JetStream Queue Adapter (persistent)
export { JetStreamQueueAdapter, createJetStreamQueueAdapter } from './jetstream.adapter';
