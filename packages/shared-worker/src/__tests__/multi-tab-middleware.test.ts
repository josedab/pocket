import { afterEach, describe, expect, it } from 'vitest';
import type { MultiTabMiddleware } from '../multi-tab-middleware.js';
import { createMultiTabMiddleware } from '../multi-tab-middleware.js';

describe('MultiTabMiddleware', () => {
  let middleware: MultiTabMiddleware;

  afterEach(() => {
    middleware?.destroy();
  });

  it('should create with a unique tab ID', () => {
    middleware = createMultiTabMiddleware({ databaseName: 'test-db' });
    expect(middleware.getTabId()).toMatch(/^tab-/);
  });

  it('should start as standalone when BroadcastChannel is unavailable', () => {
    middleware = createMultiTabMiddleware({ databaseName: 'test-db' });
    // In Node.js test environment, BroadcastChannel is not available
    middleware.start();
    expect(middleware.getRole()).toBe('standalone');
  });

  it('should be disabled when config.enabled is false', () => {
    middleware = createMultiTabMiddleware({
      databaseName: 'test-db',
      enabled: false,
    });
    middleware.start();
    expect(middleware.getRole()).toBe('standalone');
  });

  it('should report tab count', () => {
    middleware = createMultiTabMiddleware({ databaseName: 'test-db' });
    expect(middleware.getTabCount()).toBe(1); // just self
  });

  it('should not be leader in standalone mode', () => {
    middleware = createMultiTabMiddleware({ databaseName: 'test-db' });
    middleware.start();
    expect(middleware.isLeader()).toBe(false);
  });

  it('should emit health status', () => {
    middleware = createMultiTabMiddleware({ databaseName: 'test-db' });
    const healths: string[] = [];
    const sub = middleware.health.subscribe((h) => healths.push(h.role));
    middleware.start();
    sub.unsubscribe();
    expect(healths.length).toBeGreaterThan(0);
  });

  it('should broadcast mutations without errors', () => {
    middleware = createMultiTabMiddleware({ databaseName: 'test-db' });
    middleware.start();
    // Should not throw even without a connected channel
    expect(() => {
      middleware.broadcastMutation('todos', 'insert', 'doc-1');
    }).not.toThrow();
  });

  it('should clean up on destroy', () => {
    middleware = createMultiTabMiddleware({ databaseName: 'test-db' });
    middleware.start();
    expect(() => middleware.destroy()).not.toThrow();
  });
});
