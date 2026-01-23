import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Document } from '../types/document.js';
import { MigrationRunner } from './migration-runner.js';
import type { Migration, VersionedDocument } from './types.js';

interface TestDoc extends Document {
  name: string;
  value?: number;
  newField?: string;
}

const createMockStore = () => {
  const docs = new Map<string, TestDoc>();
  return {
    name: 'test',
    get: vi.fn(async (id: string) => docs.get(id) ?? null),
    getMany: vi.fn(async (ids: string[]) => ids.map((id) => docs.get(id) ?? null)),
    getAll: vi.fn(async () => [...docs.values()]),
    put: vi.fn(async (doc: TestDoc) => {
      docs.set(doc._id, doc);
      return doc;
    }),
    bulkPut: vi.fn(async (docsToSave: TestDoc[]) => {
      for (const doc of docsToSave) {
        docs.set(doc._id, doc);
      }
      return docsToSave;
    }),
    delete: vi.fn(async (id: string) => {
      docs.delete(id);
    }),
    bulkDelete: vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        docs.delete(id);
      }
    }),
    query: vi.fn(async () => []),
    count: vi.fn(async () => docs.size),
    createIndex: vi.fn(async () => {}),
    dropIndex: vi.fn(async () => {}),
    getIndexes: vi.fn(async () => []),
    changes: vi.fn(() => ({ subscribe: vi.fn() })),
    clear: vi.fn(async () => {
      docs.clear();
    }),
    _setDocs: (newDocs: TestDoc[]) => {
      docs.clear();
      for (const doc of newDocs) {
        docs.set(doc._id, doc);
      }
    },
  };
};

describe('MigrationRunner', () => {
  let store: ReturnType<typeof createMockStore>;
  let migrations: Migration[];

  beforeEach(() => {
    store = createMockStore();
    migrations = [
      {
        version: 2,
        name: 'add-default-value',
        up: (doc: TestDoc) => ({
          ...doc,
          value: doc.value ?? 0,
        }),
        down: (doc: TestDoc) => {
          const { value: _removed, ...rest } = doc;
          return rest as TestDoc;
        },
      },
      {
        version: 3,
        name: 'add-new-field',
        up: (doc: TestDoc) => ({
          ...doc,
          newField: 'default',
        }),
        down: (doc: TestDoc) => {
          const { newField: _removed, ...rest } = doc;
          return rest as TestDoc;
        },
      },
    ];
  });

  describe('getMigrationsForPath', () => {
    it('returns empty migrations when versions are equal', () => {
      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test');
      const result = runner.getMigrationsForPath(2, 2);

      expect(result.migrations).toHaveLength(0);
      expect(result.direction).toBe('up');
    });

    it('returns up migrations for upgrade', () => {
      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test');
      const result = runner.getMigrationsForPath(1, 3);

      expect(result.migrations).toHaveLength(2);
      expect(result.direction).toBe('up');
      expect(result.migrations[0].version).toBe(2);
      expect(result.migrations[1].version).toBe(3);
    });

    it('returns down migrations for downgrade', () => {
      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test');
      const result = runner.getMigrationsForPath(3, 1);

      expect(result.migrations).toHaveLength(2);
      expect(result.direction).toBe('down');
      expect(result.migrations[0].version).toBe(3);
      expect(result.migrations[1].version).toBe(2);
    });
  });

  describe('migrateDocument', () => {
    it('migrates a document up', async () => {
      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test');
      const doc: VersionedDocument<TestDoc> = {
        _id: '1',
        name: 'test',
        _schemaVersion: 1,
      };

      const result = await runner.migrateDocument(doc, 3);

      expect(result.migrated).toBe(true);
      expect(result.document.value).toBe(0);
      expect(result.document.newField).toBe('default');
      expect(result.document._schemaVersion).toBe(3);
    });

    it('migrates a document down', async () => {
      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test');
      const doc: VersionedDocument<TestDoc> = {
        _id: '1',
        name: 'test',
        value: 42,
        newField: 'custom',
        _schemaVersion: 3,
      };

      const result = await runner.migrateDocument(doc, 1);

      expect(result.migrated).toBe(true);
      expect(result.document.value).toBeUndefined();
      expect(result.document.newField).toBeUndefined();
      expect(result.document._schemaVersion).toBe(1);
    });

    it('returns original document when no migration needed', async () => {
      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test');
      const doc: VersionedDocument<TestDoc> = {
        _id: '1',
        name: 'test',
        _schemaVersion: 3,
      };

      const result = await runner.migrateDocument(doc, 3);

      expect(result.migrated).toBe(false);
      expect(result.document).toBe(doc);
    });
  });

  describe('runAll', () => {
    it('migrates all documents', async () => {
      store._setDocs([
        { _id: '1', name: 'doc1' },
        { _id: '2', name: 'doc2' },
      ]);

      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test');
      const result = await runner.runAll(1, 3);

      expect(result.totalDocuments).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.fromVersion).toBe(1);
      expect(result.toVersion).toBe(3);
    });

    it('handles migration errors with stop-on-error strategy', async () => {
      const failingMigrations: Migration[] = [
        {
          version: 2,
          up: () => {
            throw new Error('Migration failed');
          },
        },
      ];

      store._setDocs([
        { _id: '1', name: 'doc1' },
        { _id: '2', name: 'doc2' },
      ]);

      const runner = new MigrationRunner(store as never, failingMigrations, 'test-db', 'test', {
        strategy: 'stop-on-error',
      });
      const result = await runner.runAll(1, 2);

      expect(result.failureCount).toBe(1);
      expect(result.successCount).toBe(0);
    });

    it('continues on error with continue-on-error strategy', async () => {
      let callCount = 0;
      const partiallyFailingMigrations: Migration[] = [
        {
          version: 2,
          up: (doc: TestDoc) => {
            callCount++;
            if (doc._id === '1') {
              throw new Error('Migration failed');
            }
            return { ...doc, value: 0 };
          },
        },
      ];

      store._setDocs([
        { _id: '1', name: 'doc1' },
        { _id: '2', name: 'doc2' },
      ]);

      const runner = new MigrationRunner(
        store as never,
        partiallyFailingMigrations,
        'test-db',
        'test',
        { strategy: 'continue-on-error' }
      );
      const result = await runner.runAll(1, 2);

      expect(callCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.successCount).toBe(1);
    });

    it('reports progress', async () => {
      store._setDocs([
        { _id: '1', name: 'doc1' },
        { _id: '2', name: 'doc2' },
      ]);

      const progressCalls: unknown[] = [];
      const runner = new MigrationRunner(store as never, migrations, 'test-db', 'test', {
        onProgress: (p) => progressCalls.push(p),
      });

      await runner.runAll(1, 3);

      expect(progressCalls.length).toBeGreaterThan(0);
      const lastProgress = progressCalls[progressCalls.length - 1] as { phase: string };
      expect(lastProgress.phase).toBe('complete');
    });
  });
});
