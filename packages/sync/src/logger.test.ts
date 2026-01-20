import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, noopLogger, type LogEntry, type Logger } from './logger.js';

describe('createLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should log at debug level when enabled', () => {
      const logger = createLogger({ level: 'debug', enabled: true });
      logger.debug('test message');
      expect(console.debug).toHaveBeenCalled();
    });

    it('should log at info level', () => {
      const logger = createLogger({ level: 'info', enabled: true });
      logger.info('test message');
      expect(console.info).toHaveBeenCalled();
    });

    it('should log at warn level', () => {
      const logger = createLogger({ level: 'warn', enabled: true });
      logger.warn('test message');
      expect(console.warn).toHaveBeenCalled();
    });

    it('should log at error level', () => {
      const logger = createLogger({ level: 'error', enabled: true });
      logger.error('test message');
      expect(console.error).toHaveBeenCalled();
    });

    it('should respect minimum log level', () => {
      const logger = createLogger({ level: 'warn', enabled: true });

      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('enabled flag', () => {
    it('should not log when disabled', () => {
      const logger = createLogger({ enabled: false });

      logger.debug('test');
      logger.info('test');
      logger.warn('test');
      logger.error('test');

      expect(console.debug).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('custom handler', () => {
    it('should use custom handler when provided', () => {
      const entries: LogEntry[] = [];
      const customHandler = (entry: LogEntry) => entries.push(entry);

      const logger = createLogger({
        enabled: true,
        handler: customHandler,
      });

      logger.info('test message', { key: 'value' });

      expect(entries).toHaveLength(1);
      expect(entries[0]!.level).toBe('info');
      expect(entries[0]!.message).toBe('test message');
      expect(entries[0]!.data).toEqual({ key: 'value' });
      expect(entries[0]!.timestamp).toBeGreaterThan(0);
    });

    it('should include context in entries', () => {
      const entries: LogEntry[] = [];
      const customHandler = (entry: LogEntry) => entries.push(entry);

      const logger = createLogger({
        enabled: true,
        context: 'TestContext',
        handler: customHandler,
      });

      logger.info('test message');

      expect(entries[0]!.context).toBe('TestContext');
    });

    it('should include error in error entries', () => {
      const entries: LogEntry[] = [];
      const customHandler = (entry: LogEntry) => entries.push(entry);

      const logger = createLogger({
        enabled: true,
        handler: customHandler,
      });

      const testError = new Error('test error');
      logger.error('error occurred', testError);

      expect(entries[0]!.error).toBe(testError);
    });
  });

  describe('data parameter', () => {
    it('should include additional data in log entries', () => {
      const entries: LogEntry[] = [];
      const customHandler = (entry: LogEntry) => entries.push(entry);

      const logger = createLogger({
        enabled: true,
        level: 'debug', // Enable debug level to capture all logs
        handler: customHandler,
      });

      logger.debug('debug', { debugData: true });
      logger.info('info', { infoData: true });
      logger.warn('warn', { warnData: true });
      logger.error('error', undefined, { errorData: true });

      expect(entries[0]!.data).toEqual({ debugData: true });
      expect(entries[1]!.data).toEqual({ infoData: true });
      expect(entries[2]!.data).toEqual({ warnData: true });
      expect(entries[3]!.data).toEqual({ errorData: true });
    });
  });
});

describe('noopLogger', () => {
  it('should implement Logger interface', () => {
    const logger: Logger = noopLogger;

    // Should not throw
    expect(() => logger.debug('test')).not.toThrow();
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.warn('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
  });

  it('should not call console methods', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    noopLogger.debug('test');
    noopLogger.info('test');
    noopLogger.warn('test');
    noopLogger.error('test');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
