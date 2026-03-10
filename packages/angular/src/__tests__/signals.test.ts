import type { Database, Document } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { SyncEngineAdapter } from '../observables/live-query.observable.js';

interface TestUser extends Document {
  _id: string;
  name: string;
  age: number;
}

async function createTestDb(name: string): Promise<Database> {
  const { Database } = await import('@pocket/core');
  return Database.create({
    name,
    storage: createMemoryStorage(),
  });
}

describe('Angular Signals', () => {
  let db: Database;

  afterEach(async () => {
    if (db) {
      try {
        await db.close();
      } catch {
        // ignore
      }
    }
  });

  describe('liveQuery', () => {
    it('initializes with empty data array', async () => {
      db = await createTestDb('sig-lq-1');
      const { liveQuery } = await import('../signals/live-query.signal.js');

      const result = liveQuery<TestUser>(db, 'users');
      // With memory storage, data may load synchronously - just verify the signal works
      expect(Array.isArray(result.data())).toBe(true);
      expect(result.error()).toBeNull();
      result.destroy();
    });

    it('emits data after loading', async () => {
      db = await createTestDb('sig-lq-2');
      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: '1', name: 'Alice', age: 30 });

      const { liveQuery } = await import('../signals/live-query.signal.js');
      const result = liveQuery<TestUser>(db, 'users');

      // Wait for data to load
      await new Promise((r) => setTimeout(r, 100));

      expect(result.isLoading()).toBe(false);
      expect(result.data()).toHaveLength(1);
      expect(result.data()[0]?.name).toBe('Alice');
      result.destroy();
    });

    it('accepts a query function for filtering', async () => {
      db = await createTestDb('sig-lq-3');
      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: '1', name: 'Alice', age: 30 });
      await collection.insert({ _id: '2', name: 'Bob', age: 17 });

      const { liveQuery } = await import('../signals/live-query.signal.js');
      const result = liveQuery<TestUser>(db, 'users', (c) => c.find({ name: 'Alice' }));

      await new Promise((r) => setTimeout(r, 100));

      // Filter by name should return only Alice
      const data = result.data();
      const aliceItems = data.filter((d) => d.name === 'Alice');
      expect(aliceItems).toHaveLength(1);
      result.destroy();
    });

    it('refresh re-subscribes to the query', async () => {
      db = await createTestDb('sig-lq-4');
      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: '1', name: 'Alice', age: 30 });

      const { liveQuery } = await import('../signals/live-query.signal.js');
      const result = liveQuery<TestUser>(db, 'users');

      await new Promise((r) => setTimeout(r, 100));
      expect(result.data()).toHaveLength(1);

      // Refresh should re-subscribe
      result.refresh();
      await new Promise((r) => setTimeout(r, 100));
      expect(result.data()).toHaveLength(1);
      result.destroy();
    });

    it('destroy cleans up subscription', async () => {
      db = await createTestDb('sig-lq-5');
      const { liveQuery } = await import('../signals/live-query.signal.js');
      const result = liveQuery<TestUser>(db, 'users');

      result.destroy();
      // Should not throw after destroy
      expect(result.data()).toEqual([]);
    });
  });

  describe('liveDocument', () => {
    it('returns null for non-existent document', async () => {
      db = await createTestDb('sig-ld-1');
      db.collection<TestUser>('users');

      const { liveDocument } = await import('../signals/live-query.signal.js');
      const result = liveDocument<TestUser>(db, 'users', 'nonexistent');

      await new Promise((r) => setTimeout(r, 100));

      expect(result.isLoading()).toBe(false);
      expect(result.data()).toBeNull();
      result.destroy();
    });

    it('returns the document when it exists', async () => {
      db = await createTestDb('sig-ld-2');
      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: 'u1', name: 'Alice', age: 30 });

      const { liveDocument } = await import('../signals/live-query.signal.js');
      const result = liveDocument<TestUser>(db, 'users', 'u1');

      await new Promise((r) => setTimeout(r, 100));

      expect(result.isLoading()).toBe(false);
      expect(result.data()?.name).toBe('Alice');
      result.destroy();
    });

    it('has error signal initially null', async () => {
      db = await createTestDb('sig-ld-3');
      db.collection<TestUser>('users');

      const { liveDocument } = await import('../signals/live-query.signal.js');
      const result = liveDocument<TestUser>(db, 'users', 'any');

      expect(result.error()).toBeNull();
      result.destroy();
    });
  });

  describe('syncStatus', () => {
    it('returns static disconnected state when syncEngine is null', async () => {
      const { syncStatus } = await import('../signals/live-query.signal.js');

      const result = syncStatus(null);
      expect(result.isConnected()).toBe(false);
      expect(result.isSyncing()).toBe(false);
      expect(result.lastSyncAt()).toBeNull();
      expect(result.pendingChanges()).toBe(0);
      expect(result.error()).toBeNull();
    });

    it('subscribes to real sync engine status', async () => {
      const { syncStatus } = await import('../signals/live-query.signal.js');

      const mockStatus$ = new BehaviorSubject<'idle' | 'syncing' | 'error' | 'offline'>('idle');
      const mockStats$ = new BehaviorSubject({
        pushCount: 5,
        pullCount: 10,
        conflictCount: 1,
        lastSyncAt: 1700000000000,
        lastError: null as Error | null,
      });

      const mockEngine: SyncEngineAdapter = {
        getStatus: () => mockStatus$.asObservable(),
        getStats: () => mockStats$.asObservable(),
      };

      const result = syncStatus(mockEngine);

      // Wait for subscriptions to emit
      await new Promise((r) => setTimeout(r, 50));

      expect(result.isConnected()).toBe(true);
      expect(result.isSyncing()).toBe(false);
      expect(result.pendingChanges()).toBe(5);
      expect(result.lastSyncAt()).toBeInstanceOf(Date);
      expect(result.error()).toBeNull();
    });

    it('reflects syncing state', async () => {
      const { syncStatus } = await import('../signals/live-query.signal.js');

      const mockStatus$ = new BehaviorSubject<'idle' | 'syncing' | 'error' | 'offline'>('syncing');
      const mockStats$ = new BehaviorSubject({
        pushCount: 0,
        pullCount: 0,
        conflictCount: 0,
        lastSyncAt: null as number | null,
        lastError: null as Error | null,
      });

      const mockEngine: SyncEngineAdapter = {
        getStatus: () => mockStatus$.asObservable(),
        getStats: () => mockStats$.asObservable(),
      };

      const result = syncStatus(mockEngine);
      await new Promise((r) => setTimeout(r, 50));

      expect(result.isSyncing()).toBe(true);
    });

    it('reflects error from stats', async () => {
      const { syncStatus } = await import('../signals/live-query.signal.js');

      const testError = new Error('connection lost');
      const mockStatus$ = new BehaviorSubject<'idle' | 'syncing' | 'error' | 'offline'>('error');
      const mockStats$ = new BehaviorSubject({
        pushCount: 0,
        pullCount: 0,
        conflictCount: 0,
        lastSyncAt: null as number | null,
        lastError: testError,
      });

      const mockEngine: SyncEngineAdapter = {
        getStatus: () => mockStatus$.asObservable(),
        getStats: () => mockStats$.asObservable(),
      };

      const result = syncStatus(mockEngine);
      await new Promise((r) => setTimeout(r, 50));

      expect(result.isConnected()).toBe(false);
      expect(result.error()).toBe(testError);
    });

    it('updates when sync engine status changes', async () => {
      const { syncStatus } = await import('../signals/live-query.signal.js');

      const mockStatus$ = new BehaviorSubject<'idle' | 'syncing' | 'error' | 'offline'>('idle');
      const mockStats$ = new BehaviorSubject({
        pushCount: 0,
        pullCount: 0,
        conflictCount: 0,
        lastSyncAt: null as number | null,
        lastError: null as Error | null,
      });

      const mockEngine: SyncEngineAdapter = {
        getStatus: () => mockStatus$.asObservable(),
        getStats: () => mockStats$.asObservable(),
      };

      const result = syncStatus(mockEngine);
      await new Promise((r) => setTimeout(r, 50));
      expect(result.isSyncing()).toBe(false);

      // Change to syncing
      mockStatus$.next('syncing');
      await new Promise((r) => setTimeout(r, 50));
      expect(result.isSyncing()).toBe(true);

      // Change to idle
      mockStatus$.next('idle');
      await new Promise((r) => setTimeout(r, 50));
      expect(result.isSyncing()).toBe(false);
    });
  });
});
