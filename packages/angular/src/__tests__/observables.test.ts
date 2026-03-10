import type { Database, Document } from '@pocket/core';
import { createMemoryStorage } from '@pocket/storage-memory';
import { BehaviorSubject, filter, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { SyncEngineAdapter } from '../observables/live-query.observable.js';

interface TestUser extends Document {
  _id: string;
  name: string;
  age: number;
  active: boolean;
}

async function createTestDb(name: string): Promise<Database> {
  const { Database } = await import('@pocket/core');
  return Database.create({
    name,
    storage: createMemoryStorage(),
  });
}

describe('Angular Observables', () => {
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

  describe('fromLiveQuery', () => {
    it('returns observable that eventually emits query results', async () => {
      db = await createTestDb('oql-1');
      const { fromLiveQuery } = await import('../observables/live-query.observable.js');

      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: '1', name: 'Alice', age: 30, active: true });

      const lq = fromLiveQuery<TestUser>(db, 'users');
      // Live queries may emit empty first, then populate
      const data = await firstValueFrom(lq.data$.pipe(filter((d) => d.length > 0)));
      expect(data).toHaveLength(1);
      expect(data[0]?.name).toBe('Alice');
    });

    it('state$ transitions from loading to loaded', async () => {
      db = await createTestDb('oql-2');
      const { fromLiveQuery } = await import('../observables/live-query.observable.js');

      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: '1', name: 'Bob', age: 25, active: true });

      const lq = fromLiveQuery<TestUser>(db, 'users');

      // Wait for a state where data is loaded
      const loaded = await firstValueFrom(
        lq.state$.pipe(filter((s) => !s.isLoading && s.data.length > 0))
      );
      expect(loaded.isLoading).toBe(false);
      expect(loaded.data).toHaveLength(1);
      expect(loaded.error).toBeNull();
    });

    it('accepts a query function', async () => {
      db = await createTestDb('oql-3');
      const { fromLiveQuery } = await import('../observables/live-query.observable.js');

      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: '1', name: 'Alice', age: 30, active: true });
      await collection.insert({ _id: '2', name: 'Bob', age: 17, active: false });

      const lq = fromLiveQuery<TestUser>(db, 'users', (c) =>
        c.find({ active: true } as Partial<TestUser>)
      );

      const data = await firstValueFrom(lq.data$.pipe(filter((d) => d.length > 0)));
      expect(data).toHaveLength(1);
      expect(data[0]?.name).toBe('Alice');
    });
  });

  describe('fromDocument', () => {
    it('returns observable of a single document', async () => {
      db = await createTestDb('od-1');
      const { fromDocument } = await import('../observables/live-query.observable.js');

      const collection = db.collection<TestUser>('users');
      await collection.insert({ _id: 'doc-1', name: 'Alice', age: 30, active: true });

      const doc$ = fromDocument<TestUser>(db, 'users', 'doc-1');
      // observeById may emit null first, then the actual document
      const doc = await firstValueFrom(doc$.pipe(filter((d): d is TestUser => d !== null)));
      expect(doc.name).toBe('Alice');
    });

    it('returns null for non-existent document', async () => {
      db = await createTestDb('od-2');
      const { fromDocument } = await import('../observables/live-query.observable.js');

      db.collection<TestUser>('users');
      const doc$ = fromDocument<TestUser>(db, 'users', 'nonexistent');
      const doc = await firstValueFrom(doc$);
      expect(doc).toBeNull();
    });
  });

  describe('fromSyncStatus', () => {
    it('returns static offline state when syncEngine is null', async () => {
      const { fromSyncStatus } = await import('../observables/live-query.observable.js');

      const status = await firstValueFrom(fromSyncStatus(null));
      expect(status.isConnected).toBe(false);
      expect(status.isSyncing).toBe(false);
      expect(status.lastSyncAt).toBeNull();
      expect(status.pendingChanges).toBe(0);
      expect(status.error).toBeNull();
    });

    it('subscribes to real sync engine status', async () => {
      const { fromSyncStatus } = await import('../observables/live-query.observable.js');

      const mockStatus$ = new BehaviorSubject<'idle' | 'syncing' | 'error' | 'offline'>('idle');
      const mockStats$ = new BehaviorSubject({
        pushCount: 3,
        pullCount: 5,
        conflictCount: 0,
        lastSyncAt: 1700000000000,
        lastError: null as Error | null,
      });

      const mockEngine: SyncEngineAdapter = {
        getStatus: () => mockStatus$.asObservable(),
        getStats: () => mockStats$.asObservable(),
      };

      const status$ = fromSyncStatus(mockEngine);
      const status = await firstValueFrom(status$);
      expect(status).toBeDefined();
      expect(status.isSyncing).toBe(false);
      expect(status.pendingChanges).toBe(3);
      expect(status.lastSyncAt).toBeInstanceOf(Date);
      expect(status.error).toBeNull();
    });

    it('reflects syncing state', async () => {
      const { fromSyncStatus } = await import('../observables/live-query.observable.js');

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

      const status = await firstValueFrom(fromSyncStatus(mockEngine));
      expect(status.isSyncing).toBe(true);
    });

    it('reflects error in stats', async () => {
      const { fromSyncStatus } = await import('../observables/live-query.observable.js');

      const testError = new Error('sync failed');
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

      const status = await firstValueFrom(fromSyncStatus(mockEngine));
      expect(status.isSyncing).toBe(false);
      expect(status.error).toBe(testError);
    });
  });

  describe('paginateResults', () => {
    it('paginates results with default page 0', async () => {
      const { paginateResults } = await import('../observables/live-query.observable.js');
      const { of } = await import('rxjs');

      const items = Array.from({ length: 25 }, (_, i) => ({ _id: `${i}`, name: `Item ${i}` }));
      const result = await firstValueFrom(of(items).pipe(paginateResults(10)));
      expect(result.data).toHaveLength(10);
      expect(result.total).toBe(25);
      expect(result.page).toBe(0);
      expect(result.pages).toBe(3);
    });

    it('returns correct page', async () => {
      const { paginateResults } = await import('../observables/live-query.observable.js');
      const { of } = await import('rxjs');

      const items = Array.from({ length: 25 }, (_, i) => ({ _id: `${i}`, name: `Item ${i}` }));
      const result = await firstValueFrom(of(items).pipe(paginateResults(10, 2)));
      expect(result.data).toHaveLength(5);
      expect(result.page).toBe(2);
    });

    it('handles empty results', async () => {
      const { paginateResults } = await import('../observables/live-query.observable.js');
      const { of } = await import('rxjs');

      const result = await firstValueFrom(of([]).pipe(paginateResults(10)));
      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.pages).toBe(0);
    });
  });

  describe('filterResults', () => {
    it('filters results with predicate', async () => {
      const { filterResults } = await import('../observables/live-query.observable.js');
      const { of } = await import('rxjs');

      const items = [
        { _id: '1', active: true },
        { _id: '2', active: false },
        { _id: '3', active: true },
      ];

      const result = await firstValueFrom(of(items).pipe(filterResults((item) => item.active)));
      expect(result).toHaveLength(2);
    });
  });

  describe('sortResults', () => {
    it('sorts results ascending', async () => {
      const { sortResults } = await import('../observables/live-query.observable.js');
      const { of } = await import('rxjs');

      const items = [
        { _id: '1', name: 'Charlie' },
        { _id: '2', name: 'Alice' },
        { _id: '3', name: 'Bob' },
      ];

      const result = await firstValueFrom(of(items).pipe(sortResults('name', 'asc')));
      expect(result.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('sorts results descending', async () => {
      const { sortResults } = await import('../observables/live-query.observable.js');
      const { of } = await import('rxjs');

      const items = [
        { _id: '1', name: 'Alice' },
        { _id: '2', name: 'Charlie' },
        { _id: '3', name: 'Bob' },
      ];

      const result = await firstValueFrom(of(items).pipe(sortResults('name', 'desc')));
      expect(result.map((r) => r.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    });
  });
});
