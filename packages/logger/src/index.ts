export {
  createSyncLogger,
  type Logger,
  LoggerService,
  makeLogger,
  makeLoggerFromOptions,
  makeDevLogger,
  // The docs pair these two in one import line; without this export that line did not resolve.
  makeProdLogger,
  parseLogLevel,
  shutdownLogger,
  type SyncLogger,
} from './logger';

export { CompositeTransport } from './composite-transport';
export { OtlpLogTransport, type OtlpLogTransportOptions } from './otlp-transport';

export {
  LogLevel,
  type LogEntry,
  type LogFormatter,
  type LoggerConfig,
  type LoggerOptions,
  type LogTransport,
  type TraceInfo,
} from './types';
