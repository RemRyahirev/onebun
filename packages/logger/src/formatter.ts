import {
  LogEntry,
  LogFormatter,
  LogLevel,
} from './types';


/**
 * Maximum recursion depth for object formatting
 */
const MAX_OBJECT_DEPTH = 3;

/**
 * Standard width for level names alignment in console output
 */
const LEVEL_NAME_WIDTH = 7;

/**
 * Number of characters to display from trace/span IDs for brevity
 */
const TRACE_ID_DISPLAY_LENGTH = 8;


/**
 * Colors for console output
 */
const COLORS: Record<string, string> = {
  [LogLevel.Trace]: '\x1b[90m', // Gray
  [LogLevel.Debug]: '\x1b[36m', // Cyan
  [LogLevel.Info]: '\x1b[32m',  // Green
  [LogLevel.Warning]: '\x1b[33m',  // Yellow
  [LogLevel.Error]: '\x1b[31m', // Red
  [LogLevel.Fatal]: '\x1b[35m', // Magenta
  RESET: '\x1b[0m',
  DIM: '\x1b[2m',
  BRIGHT: '\x1b[1m',
};

/**
 * Format a value for pretty output
 */
function formatValue(value: unknown, depth = 0): string {
  if (value === null) {
    return '\x1b[90mnull\x1b[0m';
  }
  if (value === undefined) {
    return '\x1b[90mundefined\x1b[0m';
  }

  if (typeof value === 'string') {
    return `\x1b[32m"${value}"\x1b[0m`;
  }

  if (typeof value === 'number') {
    return `\x1b[33m${value}\x1b[0m`;
  }

  if (typeof value === 'boolean') {
    return `\x1b[35m${value}\x1b[0m`;
  }

  if (value instanceof Date) {
    return `\x1b[36m${value.toISOString()}\x1b[0m`;
  }

  if (value instanceof Error) {
    return `\x1b[31m${value.name}: ${value.message}\x1b[0m`;
  }

  if (Array.isArray(value)) {
    if (depth > MAX_OBJECT_DEPTH) {
      return '\x1b[90m[Array]\x1b[0m';
    }

    const items = value.map(item => formatValue(item, depth + 1));
    if (items.length === 0) {
      return '\x1b[90m[]\x1b[0m';
    }

    const indent = '  '.repeat(depth + 1);
    const closeIndent = '  '.repeat(depth);

    return `\x1b[90m[\x1b[0m\n${indent}${items.join(`,\n${indent}`)}\n${closeIndent}\x1b[90m]\x1b[0m`;
  }

  if (typeof value === 'object') {
    if (depth > MAX_OBJECT_DEPTH) {
      return '\x1b[90m[Object]\x1b[0m';
    }

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '\x1b[90m{}\x1b[0m';
    }

    const indent = '  '.repeat(depth + 1);
    const closeIndent = '  '.repeat(depth);

    const formattedEntries = entries.map(([key, val]) => {
      const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
        ? `\x1b[34m${key}\x1b[0m`
        : `\x1b[32m"${key}"\x1b[0m`;

      return `${formattedKey}: ${formatValue(val, depth + 1)}`;
    });

    return `\x1b[90m{\x1b[0m\n${indent}${formattedEntries.join(`,\n${indent}`)}\n${closeIndent}\x1b[90m}\x1b[0m`;
  }

  if (typeof value === 'function') {
    return `\x1b[36m[Function: ${value.name || 'anonymous'}]\x1b[0m`;
  }

  return String(value);
}

/**
 * Pretty console formatter with colors
 */
export class PrettyFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const time = entry.timestamp.toISOString();

    const level = this.getLevelName(entry.level).padEnd(LEVEL_NAME_WIDTH);
    const color = COLORS[entry.level.toString()] || '';
    const reset = COLORS.RESET;

    // Add trace information if available
    const traceInfo = entry.trace
      ? ` [trace:${entry.trace.traceId.slice(-TRACE_ID_DISPLAY_LENGTH)} span:${entry.trace.spanId.slice(-TRACE_ID_DISPLAY_LENGTH)}]`
      : '';

    // Extract className from context for main log line
    let className = '';
    let contextWithoutClassName: Record<string, unknown> = {};

    if (entry.context) {
      const { className: extractedClassName, ...restContext } = entry.context;
      if (extractedClassName && typeof extractedClassName === 'string') {
        className = ` [${extractedClassName}]`;
      }
      contextWithoutClassName = restContext;
    }

    let message = `${color}${time} [${level}]${reset}${traceInfo}${className} ${entry.message}`;

    // Handle additional data first (this is the main new functionality)
    if (contextWithoutClassName.__additionalData) {
      const additionalData = contextWithoutClassName.__additionalData as unknown[];
      if (additionalData.length > 0) {
        const formattedData = additionalData.map(data => formatValue(data)).join(' ');
        message += ` ${formattedData}`;
      }
      // Remove __additionalData from context since we've processed it
      delete contextWithoutClassName.__additionalData;
    }

    // Handle regular context (excluding special fields and className)
    if (Object.keys(contextWithoutClassName).length > 0) {
      const contextWithoutSpecialFields = { ...contextWithoutClassName };
      delete contextWithoutSpecialFields.SHOW_CONTEXT;

      if (Object.keys(contextWithoutSpecialFields).length > 0) {
        message += `\n${COLORS.DIM}Context:${COLORS.RESET} ${formatValue(contextWithoutSpecialFields)}`;
      }
    }

    if (entry.error) {
      message += `\n${COLORS[LogLevel.Error]}Error:${COLORS.RESET} ${entry.error.stack || entry.error.message}`;
    }

    return message;
  }

  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.Trace: return 'TRACE';
      case LogLevel.Debug: return 'DEBUG';
      case LogLevel.Info: return 'INFO';
      case LogLevel.Warning: return 'WARN';
      case LogLevel.Error: return 'ERROR';
      case LogLevel.Fatal: return 'FATAL';
      default: return 'UNKNOWN';
    }
  }
}

/**
 * JSON formatter for structured logging
 */
export class JsonFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const logData: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      timestamp: entry.timestamp.toISOString(),
      level: this.getLevelName(entry.level),
      message: entry.message,
    };

    if (entry.trace) {
      logData.trace = {
        traceId: entry.trace.traceId,
        spanId: entry.trace.spanId,
        ...(entry.trace.parentSpanId ? { parentSpanId: entry.trace.parentSpanId } : {}),
      };
    }

    if (entry.context) {
      const contextData = { ...entry.context };

      // Extract additional data if present
      if (contextData.__additionalData) {
        logData.additionalData = contextData.__additionalData;
        delete contextData.__additionalData;
      }

      // Add remaining context
      if (Object.keys(contextData).length > 0) {
        logData.context = contextData;
      }
    }

    if (entry.error) {
      logData.error = {
        message: entry.error.message,
        stack: entry.error.stack,
        name: entry.error.name,
      };
    }

    return JSON.stringify(logData);
  }

  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.Trace: return 'trace';
      case LogLevel.Debug: return 'debug';
      case LogLevel.Info: return 'info';
      case LogLevel.Warning: return 'warn';
      case LogLevel.Error: return 'error';
      case LogLevel.Fatal: return 'fatal';
      default: return 'unknown';
    }
  }
}
