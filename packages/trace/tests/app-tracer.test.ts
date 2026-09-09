/**
 * The ambient owner, and the one thing that makes its duplication safe.
 *
 * `@onebun/core` re-derives the context key rather than importing it from here, because
 * importing this package from `core/src/trace-scope.ts` — which the scheduler, the queue
 * adapters, the WebSocket handler and the application all import eagerly — would pull the
 * OpenTelemetry SDK, the resource and semantic-convention packages and the OTLP exporter into
 * core's module graph at load time, defeating the deliberate lazy `require('@onebun/trace')`
 * that lets an application which does not trace not pay for tracing.
 *
 * That duplication is safe only because `createContextKey` is `Symbol.for(description)`. This
 * file is what says so out loud: a drift in either spelling shows up here, rather than as spans
 * quietly going to the wrong application's provider in a process running more than one.
 */

import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  trace as otelTrace,
  type Tracer,
} from '@opentelemetry/api';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';

import { inRootTraceScope, runWithAppTracer as coreRunWithAppTracer } from '../../core/src/trace-scope';
import {
  APP_TRACER_KEY,
  appTracer,
  currentAppTracer,
  runWithAppTracer,
  withAppTracer,
} from '../src/app-tracer';
import { installContextManager, releaseContextManager } from '../src/context-manager';

/** A tracer identity, distinguishable by reference. No spans are created. */
function marker(name: string): Tracer {
  return { name } as unknown as Tracer;
}

beforeEach(() => {
  installContextManager();
});

afterEach(() => {
  releaseContextManager();
  otelTrace.disable();
});

describe('the ambient owner key', () => {
  it('is the same key as the one @onebun/core derives independently', () => {
    // The whole reason the duplication is allowed. `createContextKey` is `Symbol.for`, so both
    // modules name the same symbol; if either description is edited, this fails.
    expect(createContextKey('onebun:trace:appTracer')).toBe(APP_TRACER_KEY);
  });

  it('is read by core helpers from a context written by this package, and the reverse', () => {
    // Not just symbol equality — the two sides actually agree in use, in both directions.
    const owner = marker('written-here');

    context.with(withAppTracer(ROOT_CONTEXT, owner), () => {
      expect(coreRunWithAppTracer(owner, () => currentAppTracer())).toBe(owner);
    });

    coreRunWithAppTracer(owner, () => {
      expect(currentAppTracer()).toBe(owner);
    });
  });
});

describe('appTracer', () => {
  it('answers with the owner a boundary established', () => {
    const owner = marker('owner');

    runWithAppTracer(owner, () => {
      expect(appTracer()).toBe(owner);
    });
  });

  it('falls back to the process-global tracer outside any boundary', () => {
    // Byte-for-byte what the three decoration-time span sources did before the ambient existed,
    // which is what makes the fallback a residue rather than a regression. Asserted through a
    // stand-in provider rather than by comparing two `getTracer()` results: the API hands back
    // a fresh proxy each call, so reference equality would prove nothing either way.
    const installed = marker('from-the-global-provider');
    otelTrace.setGlobalTracerProvider({ getTracer: () => installed } as never);

    expect(currentAppTracer()).toBeUndefined();
    expect(appTracer()).toBe(installed);
  });

  it('restores the outer owner when an inner boundary ends', () => {
    const outer = marker('outer');
    const inner = marker('inner');

    runWithAppTracer(outer, () => {
      expect(appTracer()).toBe(outer);

      runWithAppTracer(inner, () => {
        expect(appTracer()).toBe(inner);
      });

      expect(appTracer()).toBe(outer);
    });
  });

  it('elides when the owner is already ambient, and when there is none to set', () => {
    const owner = marker('owner');

    runWithAppTracer(owner, () => {
      const before = context.active();

      // Same owner: no new context, so re-establishing ownership per queue message is free.
      runWithAppTracer(owner, () => {
        expect(context.active()).toBe(before);
      });

      // No owner: nothing to state, and the caller's context is left alone.
      runWithAppTracer(undefined, () => {
        expect(context.active()).toBe(before);
      });
    });
  });
});

describe('inRootTraceScope', () => {
  it('drops the parent span and keeps the owner', () => {
    // The property the queue and WebSocket boundaries depend on. Re-rooting exists so a cron
    // job does not appear under the request that armed its timer; it must not also send that
    // job's spans to whichever application registered its provider first.
    const owner = marker('owner');
    const span = otelTrace.wrapSpanContext({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    });

    runWithAppTracer(owner, () => {
      context.with(otelTrace.setSpan(context.active(), span), () => {
        expect(otelTrace.getSpan(context.active())).toBe(span);

        inRootTraceScope(() => {
          expect(otelTrace.getSpan(context.active())).toBeUndefined();
          expect(currentAppTracer()).toBe(owner);
        });
      });
    });
  });

  it('takes the owner the caller names over the one already ambient', () => {
    const ambient = marker('ambient');
    const stated = marker('stated');

    runWithAppTracer(ambient, () => {
      inRootTraceScope(() => {
        expect(currentAppTracer()).toBe(stated);
      }, stated);
    });
  });

  it('leaves the context ownerless when there is no owner anywhere', () => {
    inRootTraceScope(() => {
      expect(currentAppTracer()).toBeUndefined();
    });
  });
});
