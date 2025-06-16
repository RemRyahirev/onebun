import { LogEntry, LogFormatter, LogLevel } from './types';

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
};

/**
 * Pretty console formatter with colors
 */
export class PrettyFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    const time = entry.timestamp.toISOString();
    const level = this.getLevelName(entry.level).padEnd(7);
    const color = COLORS[entry.level.toString()] || '';
    const reset = COLORS.RESET;
    
    let message = `${color}${time} [${level}]${reset} ${entry.message}`;
    
    if (entry.context?.SHOW_CONTEXT && Object.keys(entry.context).length > 0) {
      const contextWithoutServiceFields = { ...entry.context };
      delete contextWithoutServiceFields.SHOW_CONTEXT;
      
      if (Object.keys(contextWithoutServiceFields).length > 0) {
        message += `\n${JSON.stringify(contextWithoutServiceFields, null, 2)}`;
      }
    }
    
    if (entry.error) {
      message += `\n${entry.error.stack || entry.error.message}`;
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
    return JSON.stringify({
      timestamp: entry.timestamp.toISOString(),
      level: this.getLevelName(entry.level),
      message: entry.message,
      ...(entry.context ? { context: entry.context } : {}),
      ...(entry.error ? { 
        error: {
          message: entry.error.message,
          stack: entry.error.stack,
          name: entry.error.name
        } 
      } : {})
    });
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