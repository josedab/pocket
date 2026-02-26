import { afterEach, describe, expect, it } from 'vitest';
import type { LazyMigrationDocumentStore, LazyMigrationEngine } from '../lazy-migration.js';
import { createLazyMigrationEngine } from '../lazy-migration.js';

function createMockStore(docs: Record<string, unknown>[]): LazyMigrationDocumentStore {
  const data = new Map(docs.map((d) => [d['_id'] as string, { ...d }]));
  const versions = new Map<string, number>();
  return {
    async getAll() {
      return Array.from(data.values());
    },
    async put(_col, doc) {
      data.set(doc['_id'] as string, doc);
    },
    getVersion(_col, docId) {
      return versions.get(docId);
    },
    setVersion(_col, docId, version) {
      versions.set(docId, version);
    },
  };
}

describe('LazyMigrationEngine', () => {
  let engine: LazyMigrationEngine;
  afterEach(() => engine?.destroy());

  it('should transform documents on read', () => {
    engine = createLazyMigrationEngine();
    engine.registerChain('users', {
      currentVersion: 2,
      steps: [
        { version: 1, name: 'add-role', up: (doc) => ({ ...doc, role: 'user' }) },
        { version: 2, name: 'add-active', up: (doc) => ({ ...doc, active: true }) },
      ],
    });

    const doc = { _id: 'u1', name: 'Alice' };
    const migrated = engine.transformOnRead('users', doc);
    expect(migrated['role']).toBe('user');
    expect(migrated['active']).toBe(true);
    expect(migrated['_schemaVersion']).toBe(2);
  });

  it('should skip already-migrated documents', () => {
    engine = createLazyMigrationEngine();
    engine.registerChain('users', {
      currentVersion: 1,
      steps: [
        { version: 1, name: 'add-role', up: (doc) => ({ ...doc, role: 'admin', migrated: true }) },
      ],
    });

    const doc = { _id: 'u1', name: 'Alice' };
    const first = engine.transformOnRead('users', doc);
    expect(first['migrated']).toBe(true);

    // Second read should not re-apply
    const second = engine.transformOnRead('users', { _id: 'u1', name: 'Alice', role: 'admin' });
    expect(second['name']).toBe('Alice');
  });

  it('should pass through documents with no chain', () => {
    engine = createLazyMigrationEngine();
    const doc = { _id: 'u1', name: 'Alice' };
    expect(engine.transformOnRead('unknown', doc)).toEqual(doc);
  });

  it('should rollback documents', () => {
    engine = createLazyMigrationEngine();
    engine.registerChain('users', {
      currentVersion: 2,
      steps: [
        {
          version: 1,
          name: 'add-role',
          up: (doc) => ({ ...doc, role: 'user' }),
          down: (doc) => {
            const { role: _, ...rest } = doc;
            return rest;
          },
        },
        {
          version: 2,
          name: 'add-active',
          up: (doc) => ({ ...doc, active: true }),
          down: (doc) => {
            const { active: _, ...rest } = doc;
            return rest;
          },
        },
      ],
    });

    const migrated = { _id: 'u1', name: 'Alice', role: 'user', active: true, _schemaVersion: 2 };
    const rolledBack = engine.rollback('users', 0, migrated);
    expect(rolledBack['role']).toBeUndefined();
    expect(rolledBack['active']).toBeUndefined();
    expect(rolledBack['_schemaVersion']).toBe(0);
  });

  it('should run background batch migration', async () => {
    engine = createLazyMigrationEngine({ batchSize: 2, batchDelayMs: 1 });
    engine.registerChain('todos', {
      currentVersion: 1,
      steps: [{ version: 1, name: 'add-priority', up: (doc) => ({ ...doc, priority: 'normal' }) }],
    });

    const store = createMockStore([
      { _id: 't1', title: 'A' },
      { _id: 't2', title: 'B' },
      { _id: 't3', title: 'C' },
    ]);

    const progress = await engine.runBackgroundMigration('todos', store);
    expect(progress.status).toBe('completed');
    expect(progress.migratedDocuments).toBe(3);
    expect(progress.percentComplete).toBe(100);
  });

  it('should track migration progress', async () => {
    engine = createLazyMigrationEngine({ batchSize: 10, batchDelayMs: 0 });
    engine.registerChain('items', {
      currentVersion: 1,
      steps: [{ version: 1, name: 'v1', up: (d) => ({ ...d, v: 1 }) }],
    });

    const store = createMockStore([{ _id: '1' }, { _id: '2' }]);
    await engine.runBackgroundMigration('items', store);

    const p = engine.getProgress('items');
    expect(p?.status).toBe('completed');
    expect(p?.completedAt).toBeGreaterThan(0);
  });

  it('should emit events during migration', async () => {
    engine = createLazyMigrationEngine({ batchSize: 10, batchDelayMs: 0 });
    engine.registerChain('items', {
      currentVersion: 1,
      steps: [{ version: 1, name: 'v1', up: (d) => ({ ...d, v: 1 }) }],
    });

    const events: string[] = [];
    const sub = engine.events.subscribe((e) => events.push(e.type));

    const store = createMockStore([{ _id: '1' }]);
    await engine.runBackgroundMigration('items', store);

    sub.unsubscribe();
    expect(events).toContain('batch-complete');
    expect(events).toContain('complete');
  });

  it('should return error for unregistered collection', async () => {
    engine = createLazyMigrationEngine();
    const store = createMockStore([]);
    const result = await engine.runBackgroundMigration('nonexistent', store);
    expect(result.status).toBe('error');
  });
});
