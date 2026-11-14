import {
  mock,
  spyOn,
  type Mock,
} from 'bun:test';
import { Effect } from 'effect';

import { ConsoleTransport } from '../src/transport';
import { LogLevel } from '../src/types';

type LineSpy = Mock<(line: string) => void>;

/**
 * What `ConsoleTransport` wrote, split by log level. Each spy records the line without its
 * trailing newline.
 */
export interface StreamCapture {
  /** debug and trace (stdout) */
  logSpy: LineSpy;
  /** info (stdout) */
  infoSpy: LineSpy;
  /** warn (stderr) */
  warnSpy: LineSpy;
  /** error and fatal (stderr) */
  errorSpy: LineSpy;
  clear(): void;
  restore(): void;
}

/** Restore functions of the captures that are still installed. */
const activeCaptures = new Set<() => void>();

/**
 * Intercepts `process.stdout.write` and `process.stderr.write` while `ConsoleTransport` is
 * writing a record, and files the line under the level of that record. Writes made outside the
 * transport reach the real stream.
 */
export function captureLogStreams(): StreamCapture {
  const logSpy: LineSpy = mock(() => undefined);
  const infoSpy: LineSpy = mock(() => undefined);
  const warnSpy: LineSpy = mock(() => undefined);
  const errorSpy: LineSpy = mock(() => undefined);
  let current: LogLevel | undefined;

  const target = (level: LogLevel): LineSpy => {
    switch (level) {
      case LogLevel.Error:
      case LogLevel.Fatal:
        return errorSpy;
      case LogLevel.Warning:
        return warnSpy;
      case LogLevel.Info:
        return infoSpy;
      default:
        return logSpy;
    }
  };

  const restorers: Array<() => void> = [];
  let restored = false;
  const restore = (): void => {
    if (restored) {
      return;
    }
    restored = true;
    activeCaptures.delete(restore);
    restorers.splice(0).reverse().forEach((undo) => undo());
  };

  try {
    // A capture left over from a hook that threw before its cleanup ran must not stack on this one.
    [...activeCaptures].forEach((undo) => undo());
    activeCaptures.add(restore);

    const originalLog = ConsoleTransport.prototype.log;
    const transportSpy = spyOn(ConsoleTransport.prototype, 'log').mockImplementation(function (this: ConsoleTransport, line, entry) {
      return Effect.suspend(() => {
        current = entry.level;

        return originalLog.call(this, line, entry);
      }).pipe(Effect.ensuring(Effect.sync(() => {
        current = undefined;
      })));
    });

    const intercept = (stream: NodeJS.WriteStream): ReturnType<typeof spyOn> => {
      const original = stream.write.bind(stream);

      return spyOn(stream, 'write').mockImplementation(((chunk: string | Uint8Array, ...rest: unknown[]) => {
        if (current === undefined) {
          return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
        }
        const text = String(chunk);
        target(current)(text.endsWith('\n') ? text.slice(0, -1) : text);

        return true;
      }) as never);
    };

    restorers.push(() => transportSpy.mockRestore());
    const stdoutSpy = intercept(process.stdout);
    restorers.push(() => stdoutSpy.mockRestore());
    const stderrSpy = intercept(process.stderr);
    restorers.push(() => stderrSpy.mockRestore());
  } catch (error) {
    restore();
    throw error;
  }

  return {
    logSpy,
    infoSpy,
    warnSpy,
    errorSpy,
    clear() {
      logSpy.mockClear();
      infoSpy.mockClear();
      warnSpy.mockClear();
      errorSpy.mockClear();
    },
    restore,
  };
}
