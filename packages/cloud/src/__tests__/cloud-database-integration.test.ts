/**
 * Integration tests: PocketCloud + Database wiring
 *
 * Tests that PocketCloud correctly syncs a database instance,
 * handles lifecycle transitions, and recovers from errors.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SyncableDatabase } from '../zero-config-cloud.js';
import { PocketCloud, createPocketCloud } from '../zero-config-cloud.js';

function createMockDatabase(name: string, collections: string[] = []): SyncableDatabase {
  return {
    name,
    collectionNames: () => collections,
  };
}

describe('PocketCloud + Database Integration', () => {
  const instances: PocketCloud[] = [];

  function tracked(cloud: PocketCloud): PocketCloud {
    instances.push(cloud);
    return cloud;
  }

  afterEach(async () => {
    for (const cloud of instances) {
      try {
        await cloud.destroy();
      } catch {
        /* ok */
      }
    }
    instances.length = 0;
  });

  it('should sync a database with named collections', async () => {
    const cloud = tracked(createPocketCloud({ apiKey: 'pk_test_abc123' }));
    const db = createMockDatabase('my-app', ['users', 'todos', 'settings']);

    await cloud.syncDatabase(db);

    expect(cloud.status).toBe('connected');
    expect(cloud.stats.lastSyncAt).not.toBeNull();
  });

  it('should handle multiple sync/disconnect cycles', async () => {
    const cloud = tracked(createPocketCloud({ apiKey: 'pk_test_cycle' }));
    const db = createMockDatabase('cycle-db');

    for (let i = 0; i < 3; i++) {
      await cloud.syncDatabase(db);
      expect(cloud.status).toBe('connected');

      await cloud.disconnect();
      expect(cloud.status).toBe('disconnected');
    }
  });

  it('should collect status transitions in order', async () => {
    const cloud = tracked(createPocketCloud({ apiKey: 'pk_test_transitions' }));
    const statuses: string[] = [];
    cloud.status$.subscribe((s) => statuses.push(s));

    await cloud.syncDatabase(createMockDatabase('transit-db'));
    await cloud.disconnect();

    expect(statuses).toEqual(['idle', 'connecting', 'connected', 'disconnected']);
  });

  it('should reject sync after destroy', async () => {
    const cloud = createPocketCloud({ apiKey: 'pk_test_destroy' });
    await cloud.destroy();

    await expect(cloud.syncDatabase(createMockDatabase('destroyed-db'))).rejects.toThrow(
      'destroyed'
    );
  });

  it('should resolve endpoint based on region', () => {
    const usCloud = tracked(createPocketCloud({ apiKey: 'pk_test_us', region: 'us-east-1' }));
    const euCloud = tracked(createPocketCloud({ apiKey: 'pk_test_eu', region: 'eu-west-1' }));

    expect(usCloud.getEndpoint()).toContain('us-east-1');
    expect(euCloud.getEndpoint()).toContain('eu-west-1');
  });

  it('should handle databases with no collection names method', async () => {
    const cloud = tracked(createPocketCloud({ apiKey: 'pk_test_nocolls' }));
    const db: SyncableDatabase = { name: 'simple-db' };

    await cloud.syncDatabase(db);
    expect(cloud.status).toBe('connected');
  });

  it('should accumulate errors across failed attempts', async () => {
    const cloud = tracked(
      createPocketCloud({
        apiKey: 'bad_key',
        autoReconnect: false,
      })
    );

    try {
      await cloud.syncDatabase(createMockDatabase('db1'));
    } catch {
      /* expected */
    }
    try {
      await cloud.syncDatabase(createMockDatabase('db2'));
    } catch {
      /* expected */
    }

    expect(cloud.stats.errors.length).toBe(2);
  });

  it('should maintain stats across sync cycles', async () => {
    const cloud = tracked(createPocketCloud({ apiKey: 'pk_test_stats' }));
    const db = createMockDatabase('stats-db');

    await cloud.syncDatabase(db);
    const stats1 = cloud.stats;
    expect(stats1.reconnectAttempts).toBe(0);

    await cloud.disconnect();
    await cloud.syncDatabase(db);
    const stats2 = cloud.stats;
    expect(stats2.lastSyncAt).toBeGreaterThanOrEqual(stats1.lastSyncAt!);
  });
});
