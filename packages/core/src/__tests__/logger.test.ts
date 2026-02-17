import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PocketLogger, createLogger, setDebugMode, isDebugMode } from '../observability/logger.js';

describe('PocketLogger', () => {
  afterEach(() => {
    setDebugMode(false);
  });

  describe('creation', () => {
    it('should create via factory', () => {
      const logger = createLogger({ module: 'test' });
      expect(logger).toBeInstanceOf(PocketLogger);
    });

    it('should create child loggers', () => {
      const parent = createLogger({ module: 'parent' });
      const child = parent.child('child');
      expect(child).toBeInstanceOf(PocketLogger);
    });
  });

  describe('log levels', () => {
    it('should call handler for info and above at default level', () => {
      const entries: unknown[] = [];
      const logger = createLogger({ module: 'test', handler: (e) => entries.push(e) });
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');
      // Default level is 'info', so debug should be filtered
      expect(entries).toHaveLength(3);
    });

    it('should include debug when level is debug', () => {
      const entries: unknown[] = [];
      const logger = createLogger({ module: 'test', level: 'debug', handler: (e) => entries.push(e) });
      logger.debug('debug msg');
      expect(entries).toHaveLength(1);
    });

    it('should only emit errors at error level', () => {
      const entries: unknown[] = [];
      const logger = createLogger({ module: 'test', level: 'error', handler: (e) => entries.push(e) });
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      expect(entries).toHaveLength(1);
    });
  });

  describe('debug mode', () => {
    it('should enable global debug mode', () => {
      setDebugMode(true);
      expect(isDebugMode()).toBe(true);
    });

    it('should override level when debug mode is on', () => {
      const entries: unknown[] = [];
      const logger = createLogger({ module: 'test', level: 'error', handler: (e) => entries.push(e) });
      setDebugMode(true);
      logger.debug('should appear');
      expect(entries).toHaveLength(1);
    });
  });

  describe('error logging', () => {
    it('should include error details', () => {
      const entries: Array<{ context?: Record<string, unknown> }> = [];
      const logger = createLogger({ module: 'test', handler: (e) => entries.push(e) });
      logger.error('failed', new Error('test error'), { extra: 'data' });
      expect(entries).toHaveLength(1);
      const ctx = entries[0]!.context as Record<string, unknown>;
      expect(ctx['error']).toBeDefined();
    });
  });

  describe('time', () => {
    it('should measure operation duration', () => {
      const entries: Array<{ context?: Record<string, unknown> }> = [];
      const logger = createLogger({ module: 'test', level: 'debug', handler: (e) => entries.push(e) });
      const end = logger.time('my-op');
      end({ count: 42 });
      expect(entries).toHaveLength(1);
      const ctx = entries[0]!.context as Record<string, unknown>;
      expect(ctx['durationMs']).toBeGreaterThanOrEqual(0);
      expect(ctx['count']).toBe(42);
    });
  });

  describe('JSON output', () => {
    it('should output JSON when configured', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = createLogger({ module: 'test', json: true });
      logger.info('json test');
      expect(spy).toHaveBeenCalledTimes(1);
      const output = spy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.message).toBe('json test');
      expect(parsed.module).toBe('test');
      spy.mockRestore();
    });
  });
});
