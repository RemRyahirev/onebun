import { Effect } from 'effect';
import { LogEntry, LogTransport, LogLevel } from './types';

/**
 * Console transport for logging
 */
export class ConsoleTransport implements LogTransport {
  log(formattedEntry: string, entry: LogEntry): Effect.Effect<void> {
    return Effect.sync(() => {
      switch (entry.level) {
        case LogLevel.Error:
        case LogLevel.Fatal:
          console.error(formattedEntry);
          break;
        case LogLevel.Warning:
          console.warn(formattedEntry);
          break;
        case LogLevel.Info:
          console.info(formattedEntry);
          break;
        case LogLevel.Debug:
        case LogLevel.Trace:
        default:
          console.log(formattedEntry);
      }
    });
  }
} 