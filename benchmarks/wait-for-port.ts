#!/usr/bin/env bun

/**
 * Polls an HTTP server every 5ms until it responds.
 * Exits with code 0 on success, 1 on timeout.
 * Does NOT print elapsed time — caller measures externally.
 *
 * Usage: bun run wait-for-port.ts <port> [timeout_ms]
 */

const port = Number(process.argv[2]);
const timeoutMs = Number(process.argv[3] || 15000);

if (!port) {
  process.stderr.write('Usage: wait-for-port.ts <port> [timeout_ms]\n');
  process.exit(1);
}

const deadline = Bun.nanoseconds() + timeoutMs * 1_000_000;

while (Bun.nanoseconds() < deadline) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    process.exit(0);
  } catch {
    await Bun.sleep(5);
  }
}

process.exit(1);
