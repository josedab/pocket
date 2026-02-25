import { describe, expect, it } from 'vitest';
import { EdgeDatabaseRuntime } from '../edge-runtime.js';

describe('EdgeDatabaseRuntime', () => {
  it('should start and reach running status', async () => {
    const edge = new EdgeDatabaseRuntime({
      region: 'us-east-1',
      originUrl: 'http://localhost',
      syncIntervalMs: 100000,
    });
    await edge.start();
    expect(edge.status).toBe('running');
    edge.destroy();
  });

  it('should cache and query documents', async () => {
    const edge = new EdgeDatabaseRuntime({
      region: 'eu-west-1',
      originUrl: 'http://localhost',
      syncIntervalMs: 100000,
    });
    await edge.start();
    await edge.put('users', { _id: 'u1', name: 'Alice', active: true });
    await edge.put('users', { _id: 'u2', name: 'Bob', active: false });

    const active = await edge.query('users', { active: true });
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe('Alice');
    edge.destroy();
  });

  it('should evict LRU documents when cache overflows', async () => {
    const edge = new EdgeDatabaseRuntime({
      region: 'ap-1',
      originUrl: 'http://localhost',
      maxCacheSize: 3,
      syncIntervalMs: 100000,
    });
    await edge.start();
    await edge.put('items', { _id: '1' });
    await edge.put('items', { _id: '2' });
    await edge.put('items', { _id: '3' });
    await edge.put('items', { _id: '4' }); // triggers eviction

    const stats = edge.getStats();
    expect(stats.cachedDocuments).toBe(3);
    edge.destroy();
  });

  it('should track sync stats', async () => {
    const edge = new EdgeDatabaseRuntime({
      region: 'us-west-2',
      originUrl: 'http://localhost',
      syncIntervalMs: 100000,
    });
    await edge.start();
    await edge.put('docs', { _id: '1' });
    await edge.sync();

    const stats = edge.getStats();
    expect(stats.lastSyncAt).not.toBeNull();
    expect(stats.originReachable).toBe(true);
    edge.destroy();
  });

  it('should report hot/cold document counts', async () => {
    const edge = new EdgeDatabaseRuntime({
      region: 'eu-1',
      originUrl: 'http://localhost',
      staleTolerance: 0,
      syncIntervalMs: 100000,
    });
    await edge.start();
    await edge.put('items', { _id: '1' });

    const stats = edge.getStats();
    // With staleTolerance=0, all docs become cold immediately
    expect(stats.coldDocuments + stats.hotDocuments).toBe(1);
    edge.destroy();
  });
});
