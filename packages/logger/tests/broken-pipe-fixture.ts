import { Effect } from 'effect';

import { ConsoleTransport } from '../src/transport';
import { LogLevel } from '../src/types';

const transport = new ConsoleTransport();
const LINE_COUNT = 20_000;
const SETTLE_MS = 50;
const pad = 'x'.repeat(100);

for (let i = 0; i < LINE_COUNT; i++) {
  Effect.runSync(transport.log(`line ${i} ${pad}`, { timestamp: new Date(0), level: LogLevel.Info, message: 'm' }));
}
await Bun.sleep(SETTLE_MS);
Effect.runSync(transport.log('after', { timestamp: new Date(0), level: LogLevel.Info, message: 'm' }));
