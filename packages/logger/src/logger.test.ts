import {
  describe,
  it,
  expect,
  spyOn,
  beforeEach,
  afterEach,
} from 'bun:test';
import { Effect } from 'effect';

import { JsonFormatter, PrettyFormatter } from './formatter';
import {
  LoggerService,
  createSyncLogger,
  makeDevLogger,
} from './logger';
import { makeLogger } from './logger';
import { ConsoleTransport } from './transport';
import { LogLevel, type LogEntry } from './types';


describe('PrettyFormatter', () => {
  it('formats basic info with color, level and message', () => {
    const formatter = new PrettyFormatter();
    const entry: LogEntry = {
      level: LogLevel.Info,
      message: 'Hello',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
    };
    const out = formatter.format(entry);
    expect(out).toContain('[INFO   ]');
    expect(out).toContain('Hello');
  });

  it('includes className in brackets and additionalData inline', () => {
    const formatter = new PrettyFormatter();
    const entry: LogEntry = {
      level: LogLevel.Debug,
      message: 'Data',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { className: 'Test', __additionalData: ['a', 1, true] },
    };
    const out = formatter.format(entry);
    expect(out).toContain('[Test]');
    expect(out).toContain('"a"');
    expect(out).toContain('1');
    expect(out).toContain('true');
  });

  it('prints context object pretty when present (excluding special fields)', () => {
    const formatter = new PrettyFormatter();
    const entry: LogEntry = {
      level: LogLevel.Warning,
      message: 'Warn',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      context: { a: 1, SHOW_CONTEXT: true },
    };
    const out = formatter.format(entry);
    expect(out).toContain('Context:');
    expect(out).toContain('a');
    expect(out).not.toContain('SHOW_CONTEXT');
  });

  it('includes error stack if error present', () => {
    const formatter = new PrettyFormatter();
    const error = new Error('Boom');
    const entry: LogEntry = {
      level: LogLevel.Error,
      message: 'Err',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      error,
    };
    const out = formatter.format(entry);
    expect(out).toContain('Error:');
    expect(out).toContain('Boom');
  });

  it('adds trace info with last 8 chars', () => {
    const formatter = new PrettyFormatter();
    const entry: LogEntry = {
      level: LogLevel.Info,
      message: 'Traced',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      trace: { traceId: '1234567890abcdef', spanId: 'abcdef1234567890' },
    } as LogEntry;
    const out = formatter.format(entry);
    expect(out).toContain('trace:90abcdef');
    expect(out).toContain('span:34567890');
  });
});

describe('JsonFormatter', () => {
  it('produces structured json', () => {
    const formatter = new JsonFormatter();
    const entry: LogEntry = {
      level: LogLevel.Info,
      message: 'Hi',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { x: 1, __additionalData: [2, 'b'] },
      error: new Error('E'),
      trace: { traceId: 't', spanId: 's', parentSpanId: 'p' },
    };
    const obj = JSON.parse(formatter.format(entry));
    expect(obj.level).toBe('info');
    expect(obj.message).toBe('Hi');
    expect(obj.context).toEqual({ x: 1 });
    expect(obj.additionalData).toEqual([2, 'b']);
    expect(obj.error.message).toBe('E');
    expect(obj.trace.traceId).toBe('t');
    expect(obj.trace.parentSpanId).toBe('p');
  });
});

describe('ConsoleTransport', () => {
  const transport = new ConsoleTransport();
  let logSpy: ReturnType<typeof spyOn>;
  let infoSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => undefined);
    infoSpy = spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const ts = new Date();
  const base: Omit<LogEntry, 'level'|'message'> = { timestamp: ts };

  it('routes info to console.info', () => {
    Effect.runSync(transport.log('x', { ...base, level: LogLevel.Info, message: 'm' }));
    expect(infoSpy).toHaveBeenCalled();
  });

  it('routes warn to console.warn', () => {
    Effect.runSync(transport.log('x', { ...base, level: LogLevel.Warning, message: 'm' }));
    expect(warnSpy).toHaveBeenCalled();
  });

  it('routes error/fatal to console.error and others to console.log', () => {
    Effect.runSync(transport.log('x', { ...base, level: LogLevel.Error, message: 'm' }));
    expect(errorSpy).toHaveBeenCalled();
    Effect.runSync(transport.log('x', { ...base, level: LogLevel.Fatal, message: 'm' }));
    expect(errorSpy).toHaveBeenCalledTimes(2);
    Effect.runSync(transport.log('x', { ...base, level: LogLevel.Debug, message: 'm' }));
    expect(logSpy).toHaveBeenCalled();
  });

  it('routes trace to console.log', () => {
    Effect.runSync(transport.log('trace message', { ...base, level: LogLevel.Trace, message: 'trace' }));
    expect(logSpy).toHaveBeenCalledWith('trace message');
  });

  it('should create ConsoleTransport instance', () => {
    const newTransport = new ConsoleTransport();
    expect(newTransport).toBeInstanceOf(ConsoleTransport);
    expect(typeof newTransport.log).toBe('function');
  });

  it('should create ConsoleTransport with implicit constructor', () => {
    // Test explicit constructor call to improve coverage
    const transport1 = new ConsoleTransport();
    const transport2 = new ConsoleTransport();
    
    expect(transport1).toBeInstanceOf(ConsoleTransport);
    expect(transport2).toBeInstanceOf(ConsoleTransport);
    expect(transport1).not.toBe(transport2); // Different instances
  });

  it('should handle unknown log level', () => {
    // Test the default case in switch statement
    const unknownLevel = 999 as LogLevel;
    Effect.runSync(transport.log('unknown level', { ...base, level: unknownLevel, message: 'test' }));
    expect(logSpy).toHaveBeenCalledWith('unknown level');
  });
});

describe('Logger + SyncLogger basic flow', () => {
  it('filters by minLevel and merges contexts and additional data', () => {
    // Create a minimal logger by constructing our own transport that captures output
    const outputs: string[] = [];
    const transport = new (class extends ConsoleTransport {
      override log(formattedEntry: string, entry: LogEntry) {
        return Effect.sync(() => {
          outputs.push(formattedEntry + '|' + entry.level);
        });
      }
    })();

    const loggerLayer = makeDevLogger({ minLevel: LogLevel.Info, transport });

    // Extract the underlying logger by creating a small helper service instance
    // We cannot easily read from Layer in tests, so we re-create SyncLogger through
    // the public API using LoggerService tag and Effect runtime.

    // Build a ad-hoc logger effect from the layer and run logging through Effect directly
    const loggerEffect = Effect.flatMap(LoggerService, (logger) => Effect.succeed(logger));
    const provided = Effect.provide(loggerEffect, loggerLayer);
    const logger = Effect.runSync(provided);

    // Create sync wrapper for easier calls
    const sync = createSyncLogger(logger);

    sync.debug('dropped'); // below Info, should be filtered
    sync.info('hello', { a: 1 }, 'xtra');

    expect(outputs.length).toBe(1);
    expect(outputs[0]).toContain('hello');
    expect(outputs[0]).toContain('Context');
  });

  it('child adds context and uses global trace context in SyncLogger', () => {
    const outputs: LogEntry[] = [];
    const transport = new (class extends ConsoleTransport {
      override log(_formattedEntry: string, entry: LogEntry) {
        return Effect.sync(() => {
          outputs.push(entry);
        });
      }
    })();

    const layer = makeDevLogger({ transport });
    const logger = Effect.runSync(Effect.provide(Effect.flatMap(LoggerService, (l) => Effect.succeed(l)), layer));
    const sync = createSyncLogger(logger);

    // set global trace for SyncLogger path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__onebunCurrentTraceContext = { traceId: 't123456789', spanId: 's123456789' };

    const child = sync.child({ className: 'Child' });
    child.info('hi');

    expect(outputs[0].context?.className).toBe('Child');
    expect(outputs[0].trace?.traceId).toBe('t123456789');
  });
});


// Additional tests to improve coverage near 100%

describe('PrettyFormatter - additional value shapes', () => {
  it('formats various value types in additionalData', () => {
    const f = new PrettyFormatter();
    const err = new Error('X');
    const fn = function namedFn() {
      return 1;
    };
    const entry: LogEntry = {
      level: LogLevel.Debug,
      message: 'v',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [null, undefined, 123, 's', false, new Date('2025-01-01T00:00:00.000Z'), err, fn] },
    };
    const out = f.format(entry);
    expect(out).toContain('null');
    expect(out).toContain('undefined');
    expect(out).toContain('123');
    expect(out).toContain('"s"');
    expect(out).toContain('false');
    expect(out).toContain('2025-01-01T00:00:00.000Z');
    expect(out).toContain('Error: X');
    expect(out).toContain('[Function: namedFn]');
  });

  it('pretty prints empty and deep structures with truncation', () => {
    const f = new PrettyFormatter();
    const deep = { a: { b: { c: { d: 1 } } } };
    const entry: LogEntry = {
      level: LogLevel.Info,
      message: 'ctx',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      context: { emptyObj: {}, emptyArr: [], deep },
    };
    const out = f.format(entry);
    expect(out).toContain('emptyObj');
    expect(out).toContain('{}');
    expect(out).toContain('emptyArr');
    expect(out).toContain('[]');
    // при глубокой структуре встречается маркер [Object]
    expect(out).toContain('[Object]');
  });
});

describe('JsonFormatter - variants', () => {
  it('omits context and additionalData when absent; trace without parent', () => {
    const f = new JsonFormatter();
    const entry: LogEntry = {
      level: LogLevel.Trace,
      message: 'j',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      trace: { traceId: 'tt', spanId: 'ss' },
    };
    const o = JSON.parse(f.format(entry));
    expect(o.level).toBe('trace');
    expect(o.context).toBeUndefined();
    expect(o.additionalData).toBeUndefined();
    expect(o.trace.traceId).toBe('tt');
    expect(o.trace.parentSpanId).toBeUndefined();
  });
});

describe('LoggerImpl methods and makeLogger env selection', () => {
  it('calls all level methods at or above minLevel', () => {
    const seen: LogEntry[] = [];
    const transport = new (class extends ConsoleTransport {
      override log(_formatted: string, e: LogEntry) {
        return Effect.sync(() => {
          seen.push(e);
        });
      }
    })();
    const layer = makeDevLogger({ minLevel: LogLevel.Trace, transport });
    const logger = Effect.runSync(Effect.provide(Effect.flatMap(LoggerService, (l) => Effect.succeed(l)), layer));
    const sync = createSyncLogger(logger);
    sync.trace('t');
    sync.debug('d');
    sync.info('i');
    sync.warn('w');
    sync.error('e', new Error('E1'));
    sync.fatal('f', new Error('E2'));
    expect(seen.map((e) => e.level)).toEqual([
      LogLevel.Trace, LogLevel.Debug, LogLevel.Info, LogLevel.Warning, LogLevel.Error, LogLevel.Fatal,
    ]);
  });

  it('makeLogger picks prod logger when NODE_ENV=production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const seen: LogEntry[] = [];
    const transport = new (class extends ConsoleTransport {
      override log(_formatted: string, e: LogEntry) {
        return Effect.sync(() => {
          seen.push(e);
        });
      }
    })();
    const layer = makeLogger({ transport });
    const logger = Effect.runSync(Effect.provide(Effect.flatMap(LoggerService, (l) => Effect.succeed(l)), layer));
    const sync = createSyncLogger(logger);
    // Debug должен быть отфильтрован в prod (minLevel Info)
    sync.debug('dbg');
    sync.info('ok');
    expect(seen.length).toBe(1);
    expect(seen[0].level).toBe(LogLevel.Info);
    process.env.NODE_ENV = prev;
  });
});

describe('LoggerImpl trace context fallback to __onebunTraceService', () => {
  it('uses global trace service when current trace context is absent', () => {
    // очистить direct context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__onebunCurrentTraceContext = undefined;
    const outputs: LogEntry[] = [];
    const transport = new (class extends ConsoleTransport {
      override log(_f: string, e: LogEntry) {
        return Effect.sync(() => {
          outputs.push(e);
        });
      }
    })();
    // подготовить псевдо trace service
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__onebunTraceService = {
      getCurrentTraceContext: () => Effect.succeed({ traceId: 'svc-trace', spanId: 'svc-span' }),
    };

    const layer = makeDevLogger({ transport });
    const logger = Effect.runSync(Effect.provide(Effect.flatMap(LoggerService, (l) => Effect.succeed(l)), layer));
    const sync = createSyncLogger(logger);
    sync.info('ping');

    expect(outputs[0].trace?.traceId).toBe('svc-trace');
  });
});


// Added tests to raise function coverage for formatter.ts

describe('Formatter getLevelName coverage', () => {
  it('JsonFormatter maps all levels to lowercase names', () => {
    const f = new JsonFormatter();
    const ts = new Date('2025-01-01T00:00:00.000Z');
    const mk = (level: LogLevel) => JSON.parse(f.format({ level, message: 'm', timestamp: ts })).level as string;
    expect(mk(LogLevel.Trace)).toBe('trace');
    expect(mk(LogLevel.Debug)).toBe('debug');
    expect(mk(LogLevel.Info)).toBe('info');
    expect(mk(LogLevel.Warning)).toBe('warn');
    expect(mk(LogLevel.Error)).toBe('error');
    expect(mk(LogLevel.Fatal)).toBe('fatal');
  });

  it('PrettyFormatter maps TRACE and FATAL to bracketed level names', () => {
    const f = new PrettyFormatter();
    const ts = new Date('2025-01-01T00:00:00.000Z');
    const outTrace = f.format({ level: LogLevel.Trace, message: 't', timestamp: ts });
    const outFatal = f.format({ level: LogLevel.Fatal, message: 'f', timestamp: ts });
    expect(outTrace).toContain('[TRACE  ]');
    expect(outFatal).toContain('[FATAL  ]');
  });
});

describe('formatValue rare branches via PrettyFormatter additionalData', () => {
  it('handles empty array and multi-element array with pretty multi-line', () => {
    const f = new PrettyFormatter();
    const ts = new Date('2025-01-01T00:00:00.000Z');
    const outEmpty = f.format({
      level: LogLevel.Debug,
      message: 'empty',
      timestamp: ts,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [[]] },
    });
    expect(outEmpty).toContain('[]');

    const outNonEmpty = f.format({
      level: LogLevel.Debug,
      message: 'nonempty',
      timestamp: ts,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [[1, 2, 3]] },
    });
    // Ожидаем многострочное форматирование массива (наличие символов [ и ] с переносами строк)
    expect(outNonEmpty).toMatch(/\[\x1b\[0m\n/); // присутствует перевод строки после [
  });

  it('handles deep nested array producing [Array] marker when depth exceeded', () => {
    const f = new PrettyFormatter();
    const deepArr = [[[[[1]]]]]; // глубина 5 (> MAX_OBJECT_DEPTH)
    const out = f.format({
      level: LogLevel.Debug,
      message: 'deep',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [deepArr] },
    });
    expect(out).toContain('[Array]');
  });

  it('formats object keys that require quotes', () => {
    const f = new PrettyFormatter();
    const out = f.format({
      level: LogLevel.Info,
      message: 'obj',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { 'a-b': 1 },
    });
    // Ключ с дефисом должен печататься в кавычках
    expect(out).toContain('"a-b"');
  });

  it('prints anonymous function with fallback name and covers String(value) for symbol and bigint', () => {
    const f = new PrettyFormatter();
    // анонимная функция

    const anon = function () {
      return 0;
    };
    const sym = Symbol('s');
    const big = BigInt(42);
    const out = f.format({
      level: LogLevel.Debug,
      message: 'misc',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [anon, sym, big] },
    });
    expect(out).toContain('[Function:');
    // символы и бигинты проходят в String(value)
    expect(out).toContain('Symbol(s)');
    expect(out).toContain('42');
  });
});

describe('Formatter edge cases and additional coverage', () => {
  it('PrettyFormatter should handle Set and Map objects', () => {
    const formatter = new PrettyFormatter();
    const set = new Set([1, 2, 3]);
    const map = new Map([['key', 'value']]);

    const out = formatter.format({
      level: LogLevel.Info,
      message: 'collections',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [set, map] },
    });

    // Sets and Maps are formatted as empty objects {} in the formatter
    expect(out).toContain('{}');
    expect(out).toContain('collections');
  });

  it('PrettyFormatter should handle Date objects', () => {
    const formatter = new PrettyFormatter();
    const date = new Date('2025-01-01T12:00:00.000Z');

    const out = formatter.format({
      level: LogLevel.Info,
      message: 'dates',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [date] },
    });

    expect(out).toContain('2025');
  });

  it('PrettyFormatter should handle class instances', () => {
    const formatter = new PrettyFormatter();
    
    class TestClass {
      prop = 'value';
    }
    
    const instance = new TestClass();

    const out = formatter.format({
      level: LogLevel.Info,
      message: 'instance',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      context: { __additionalData: [instance] },
    });

    // Class instances show their properties, not class name
    expect(out).toContain('prop');
    expect(out).toContain('value');
  });

  it('JsonFormatter should handle all log levels correctly', () => {
    const formatter = new JsonFormatter();
    const timestamp = new Date('2025-01-01T00:00:00.000Z');

    // Test all log levels
    const levels = [LogLevel.Trace, LogLevel.Debug, LogLevel.Info, LogLevel.Warning, LogLevel.Error, LogLevel.Fatal];
    
    levels.forEach(level => {
      const out = formatter.format({
        level,
        message: 'test',
        timestamp,
      });
      
      const parsed = JSON.parse(out);
      expect(parsed.level).toBeDefined();
      expect(parsed.message).toBe('test');
    });
  });

  it('PrettyFormatter should handle complex nested structures with formatting', () => {
    const formatter = new PrettyFormatter();
    
    const complexData = {
      level1: {
        level2: {
          level3: {
            deep: 'value',
            array: [1, 2, { nested: true }],
          },
        },
      },
    };

    const out = formatter.format({
      level: LogLevel.Info,
      message: 'complex',
      timestamp: new Date('2025-01-01T00:00:00.000Z'),
      context: complexData,
    });

    expect(out).toContain('level1');
    expect(out).toContain('level2');
    expect(out).toContain('level3');
  });
});
