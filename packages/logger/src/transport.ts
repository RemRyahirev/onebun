import { Effect } from 'effect';

import {
  type LogEntry,
  LogLevel,
  type LogTransport,
} from './types';

/** Streams that already carry the broken-pipe listener. */
const guardedStreams = new WeakSet<NodeJS.WriteStream>();

/**
 * Keeps a closed output pipe (`app | head`) from ending the process. A write to a closed pipe
 * emits an `EPIPE` 'error' event on the stream; unhandled, it terminates the process, whereas a
 * `console.*` call drops the line. The listener is installed once per stream and ignores only
 * `EPIPE`. Any other error is rethrown unless the application has its own 'error' listener on
 * the stream, so it surfaces exactly as it would without the transport.
 */
function guardBrokenPipe(stream: NodeJS.WriteStream): NodeJS.WriteStream {
  if (!guardedStreams.has(stream)) {
    guardedStreams.add(stream);
    const guard = (error: NodeJS.ErrnoException): void => {
      if (error.code !== 'EPIPE' && stream.listenerCount('error') === 1) {
        throw error;
      }
    };
    stream.on('error', guard);
  }

  return stream;
}

/**
 * Console transport for logging.
 *
 * Writes every record, followed by a newline, through the process streams:
 * `process.stderr` for `warn`, `error` and `fatal`, `process.stdout` for `info`, `debug` and `trace`.
 * A closed output pipe (`EPIPE`) drops the line without an error.
 *
 * @see docs:api/logger.md
 */
export class ConsoleTransport implements LogTransport {
  log(formattedEntry: string, entry: LogEntry): Effect.Effect<void> {
    return Effect.sync(() => {
      switch (entry.level) {
        case LogLevel.Error:
        case LogLevel.Fatal:
        case LogLevel.Warning:
          guardBrokenPipe(process.stderr).write(`${formattedEntry}\n`);
          break;
        case LogLevel.Info:
        case LogLevel.Debug:
        case LogLevel.Trace:
        default:
          guardBrokenPipe(process.stdout).write(`${formattedEntry}\n`);
      }
    });
  }
}
