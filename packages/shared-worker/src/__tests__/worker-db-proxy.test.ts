import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkerDBProxy, createWorkerDBProxy } from '../worker-db-proxy.js';

describe('WorkerDBProxy', () => {
  let proxy: WorkerDBProxy;

  beforeEach(async () => {
    proxy = createWorkerDBProxy({
      databaseName: 'test-db',
      preferSharedWorker: false,
      broadcastFallback: false,
    });
    await proxy.connect();
  });

  afterEach(() => {
    proxy.disconnect();
  });

  it('should connect successfully in direct mode', () => {
    expect(proxy.status).toBe('connected');
    const stats = proxy.getStats();
    expect(stats.mode).toBe('direct');
    expect(stats.isLeader).toBe(true);
  });

  it('should generate unique tab IDs', () => {
    const proxy2 = createWorkerDBProxy({ databaseName: 'test-db' });
    expect(proxy.tabId).not.toBe(proxy2.tabId);
  });

  it('should execute queries', async () => {
    const result = await proxy.query('todos', { completed: false });
    expect(result).toBeDefined();
  });

  it('should deduplicate identical queries', async () => {
    // Fire two identical queries simultaneously
    const [r1, r2] = await Promise.all([
      proxy.query('todos', { completed: false }),
      proxy.query('todos', { completed: false }),
    ]);

    const stats = proxy.getStats();
    expect(stats.deduplicatedQueries).toBe(1);
  });

  it('should execute inserts', async () => {
    const result = await proxy.insert('todos', { title: 'Test', completed: false });
    expect(result).toBeDefined();
  });

  it('should execute updates', async () => {
    const result = await proxy.update('todos', 'id-1', { completed: true });
    expect(result).toBeDefined();
  });

  it('should execute deletes', async () => {
    const result = await proxy.remove('todos', 'id-1');
    expect(result).toBeDefined();
  });

  it('should track request statistics', async () => {
    await proxy.query('todos', {});
    await proxy.insert('todos', { title: 'Test' });

    const stats = proxy.getStats();
    expect(stats.totalRequests).toBe(2);
    expect(stats.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should broadcast change notifications', () => {
    const changes: unknown[] = [];
    proxy.changes$.subscribe((c) => changes.push(c));

    proxy.broadcastChange('todos', 'id-1', 'update');
    // In direct mode, broadcasts don't loop back to self
    expect(changes.length).toBe(0);
  });
});
