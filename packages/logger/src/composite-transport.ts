import { Effect } from 'effect';

import type { LogEntry, LogTransport } from './types';

/**
 * Composite transport that dispatches log entries to multiple transports.
 *
 * Used internally when both Console and OTLP transports are configured.
 */
export class CompositeTransport implements LogTransport {
  constructor(private readonly transports: LogTransport[]) {}

  log(formattedEntry: string, entry: LogEntry): Effect.Effect<void> {
    return Effect.all(
      this.transports.map((t) => t.log(formattedEntry, entry)),
      { discard: true },
    );
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      this.transports.map((t) => t.shutdown?.()),
    );
  }
}
