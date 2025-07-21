import { Effect } from 'effect';

import {
  type LogEntry,
  type LogTransport,
  LogLevel,
} from './types';

/**
 * Console transport for logging
 */
export class ConsoleTransport implements LogTransport {
  log(formattedEntry: string, entry: LogEntry): Effect.Effect<void> {
    return Effect.sync(() => {
      switch (entry.level) {
        case LogLevel.Error:
        case LogLevel.Fatal:
          // eslint-disable-next-line no-console
          console.error(formattedEntry);
          break;
        case LogLevel.Warning:
          // eslint-disable-next-line no-console
          console.warn(formattedEntry);
          break;
        case LogLevel.Info:
          // eslint-disable-next-line no-console
          console.info(formattedEntry);
          break;
        case LogLevel.Debug:
        case LogLevel.Trace:
        default:
          // eslint-disable-next-line no-console
          console.log(formattedEntry);
      }
    });
  }
}
