/**
 * Log levels for structured logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: string;
  data?: Record<string, unknown>;
  error?: Error;
}

/**
 * Logger interface that consumers can implement
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error, data?: Record<string, unknown>): void;
}

/**
 * Logger options
 */
export interface LoggerOptions {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Context name (e.g., 'SyncEngine', 'Transport') */
  context?: string;
  /** Custom log handler */
  handler?: (entry: LogEntry) => void;
  /** Enable logging (default: false in production) */
  enabled?: boolean;
}

/**
 * Log level priority (higher = more severe)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Default log handler that outputs to console with structured format
 */
function defaultLogHandler(entry: LogEntry): void {
  const prefix = entry.context ? `[${entry.context}]` : '';
  const timestamp = new Date(entry.timestamp).toISOString();
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';

  switch (entry.level) {
    case 'debug':
      console.debug(`${timestamp} DEBUG${prefix} ${entry.message}${dataStr}`);
      break;
    case 'info':
      console.info(`${timestamp} INFO${prefix} ${entry.message}${dataStr}`);
      break;
    case 'warn':
      console.warn(`${timestamp} WARN${prefix} ${entry.message}${dataStr}`);
      break;
    case 'error':
      console.error(`${timestamp} ERROR${prefix} ${entry.message}${dataStr}`, entry.error ?? '');
      break;
  }
}

/**
 * Create a structured logger
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const {
    level = 'info',
    context,
    handler = defaultLogHandler,
    enabled = process.env.NODE_ENV !== 'production',
  } = options;

  const minPriority = LOG_LEVEL_PRIORITY[level];

  function shouldLog(logLevel: LogLevel): boolean {
    if (!enabled) return false;
    return LOG_LEVEL_PRIORITY[logLevel] >= minPriority;
  }

  function log(
    logLevel: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!shouldLog(logLevel)) return;

    const entry: LogEntry = {
      level: logLevel,
      message,
      timestamp: Date.now(),
      context,
      data,
      error,
    };

    handler(entry);
  }

  return {
    debug(message: string, data?: Record<string, unknown>): void {
      log('debug', message, data);
    },
    info(message: string, data?: Record<string, unknown>): void {
      log('info', message, data);
    },
    warn(message: string, data?: Record<string, unknown>): void {
      log('warn', message, data);
    },
    error(message: string, error?: Error, data?: Record<string, unknown>): void {
      log('error', message, data, error);
    },
  };
}

/**
 * No-op logger that doesn't output anything
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
