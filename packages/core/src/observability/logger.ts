/**
 * Structured logging for Pocket core.
 *
 * Provides a lightweight, zero-dependency structured logger with levels,
 * JSON output, operation context, and a global debug mode toggle.
 *
 * @module observability/logger
 */

/** Log level */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured log entry */
export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: number;
  readonly module: string;
  readonly context?: Record<string, unknown>;
  readonly durationMs?: number;
  readonly error?: { message: string; stack?: string };
}

/** Logger configuration */
export interface PocketLoggerConfig {
  /** Minimum log level (default: 'info') */
  readonly level?: LogLevel;
  /** Enable debug mode (overrides level to 'debug') */
  readonly debug?: boolean;
  /** Module name prefix */
  readonly module?: string;
  /** Custom log handler (default: console) */
  readonly handler?: (entry: LogEntry) => void;
  /** Enable JSON output format */
  readonly json?: boolean;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalDebug = false;

/** Enable/disable global debug mode for all Pocket loggers */
export function setDebugMode(enabled: boolean): void {
  globalDebug = enabled;
}

/** Check if global debug mode is enabled */
export function isDebugMode(): boolean {
  return globalDebug;
}

/**
 * Structured logger for Pocket modules.
 *
 * @example
 * ```typescript
 * import { createLogger } from '@pocket/core';
 *
 * const log = createLogger({ module: 'sync-engine', level: 'debug' });
 *
 * log.info('Sync started', { collections: ['todos'] });
 * log.debug('Processing batch', { count: 50 });
 *
 * const end = log.time('sync-pull');
 * // ... do work ...
 * end(); // logs "sync-pull completed" with durationMs
 * ```
 */
export class PocketLogger {
  private readonly config: Required<Omit<PocketLoggerConfig, 'handler' | 'json'>> &
    Pick<PocketLoggerConfig, 'handler' | 'json'>;

  constructor(config: PocketLoggerConfig = {}) {
    this.config = {
      level: config.debug ? 'debug' : (config.level ?? 'info'),
      debug: config.debug ?? false,
      module: config.module ?? 'pocket',
      handler: config.handler,
      json: config.json,
    };
  }

  /** Create a child logger with a sub-module prefix */
  child(subModule: string): PocketLogger {
    return new PocketLogger({
      ...this.config,
      module: `${this.config.module}:${subModule}`,
    });
  }

  /** Log at debug level */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /** Log at info level */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /** Log at warn level */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /** Log at error level */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log('error', message, {
      ...context,
      ...(error ? { error: { message: error.message, stack: error.stack } } : {}),
    });
  }

  /**
   * Start a timer. Returns a function that logs completion with duration.
   *
   * @example
   * ```typescript
   * const end = logger.time('query-execution');
   * await executeQuery();
   * end({ resultCount: 42 }); // logs with durationMs
   * ```
   */
  time(operation: string): (context?: Record<string, unknown>) => void {
    const start = performance.now();
    return (context?: Record<string, unknown>) => {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      this.log('debug', `${operation} completed`, { ...context, durationMs });
    };
  }

  // ── Private ──────────────────────────────────────────────────────────

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const effectiveLevel = globalDebug ? 'debug' : this.config.level;
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[effectiveLevel]) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      module: this.config.module,
      ...(context ? { context } : {}),
    };

    if (this.config.handler) {
      this.config.handler(entry);
      return;
    }

    if (this.config.json) {
      const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      consoleFn(JSON.stringify(entry));
    }
    // Silent by default in non-debug mode with no handler
  }
}

/** Factory function to create a PocketLogger */
export function createLogger(config?: PocketLoggerConfig): PocketLogger {
  return new PocketLogger(config);
}
