/**
 * One `GET` through the HTTP client under `connectAddress`, in a fresh process:
 * `bun <this file>` with `FIXTURE_URL` and `FIXTURE_CONNECT_ADDRESS` set.
 *
 * A process of its own because the only way to make `fetch` trust a test CA without touching the
 * client is `NODE_EXTRA_CA_CERTS`, and Bun reads it once, at startup. The client is exactly what an
 * application gets: no `tls` option, no wrapper around `fetch`.
 *
 * Prints one `RESULT_MARKER` line with what the call resolved or failed with.
 */
import { Effect } from 'effect';

import { createHttpClient } from '../client';

import { type PinnedRequestResult, RESULT_MARKER } from './fixture-protocol';

const client = createHttpClient({ retries: { max: 0 } });
const outcome = await Effect.runPromise(Effect.either(client.getEffect(
  process.env.FIXTURE_URL ?? '',
  undefined,
  { connectAddress: process.env.FIXTURE_CONNECT_ADDRESS },
)));

const result: PinnedRequestResult = outcome._tag === 'Right'
  ? {
    success: true,
    statusCode: outcome.right.success ? outcome.right.statusCode : undefined,
    result: outcome.right.success ? outcome.right.result : undefined,
  }
  : {
    success: false,
    error: outcome.left.error,
    causeCode: String((outcome.left.details?.details as { code?: unknown } | undefined)?.code),
  };

process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
