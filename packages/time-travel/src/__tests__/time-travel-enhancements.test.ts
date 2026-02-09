import { describe, it, expect, afterEach } from 'vitest';
import {
  PersistentHistory,
  MemoryHistoryStorage,
  createPersistentHistory,
} from '../persistent-history.js';
import { AuditExporter, createAuditExporter } from '../audit-export.js';
import type { PersistentHistoryEntry } from '../persistent-history.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeHistory(): PersistentHistory {
  return createPersistentHistory({
    storage: new MemoryHistoryStorage(),
    namespace: 'test',
    maxEntries: 100,
    autoSaveIntervalMs: 60_000, // long interval to avoid timer noise
  });
}

function makeEntry(overrides: Partial<PersistentHistoryEntry> = {}): PersistentHistoryEntry {
  return {
    id: overrides.id ?? 'entry-1',
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    operation: overrides.operation ?? 'insert',
    collection: overrides.collection ?? 'todos',
    documentId: overrides.documentId ?? 'doc-1',
    before: overrides.before ?? null,
    after: overrides.after ?? { title: 'Buy groceries' },
    metadata: overrides.metadata,
  };
}

/* ================================================================== */
/*  MemoryHistoryStorage                                               */
/* ================================================================== */

describe('MemoryHistoryStorage', () => {
  it('should save and load data', async () => {
    const storage = new MemoryHistoryStorage();
    await storage.save('key-1', 'hello');
    const result = await storage.load('key-1');
    expect(result).toBe('hello');
  });

  it('should return null for missing keys', async () => {
    const storage = new MemoryHistoryStorage();
    const result = await storage.load('nonexistent');
    expect(result).toBeNull();
  });

  it('should delete data', async () => {
    const storage = new MemoryHistoryStorage();
    await storage.save('key-1', 'value');
    await storage.delete('key-1');
    const result = await storage.load('key-1');
    expect(result).toBeNull();
  });

  it('should list keys by prefix', async () => {
    const storage = new MemoryHistoryStorage();
    await storage.save('app:history:entries', '[]');
    await storage.save('app:history:snapshots', '[]');
    await storage.save('other:key', 'x');

    const keys = await storage.list('app:history');
    expect(keys).toHaveLength(2);
    expect(keys).toContain('app:history:entries');
    expect(keys).toContain('app:history:snapshots');
  });
});

/* ================================================================== */
/*  PersistentHistory                                                  */
/* ================================================================== */

describe('PersistentHistory', () => {
  let history: PersistentHistory;

  afterEach(() => {
    history?.destroy();
  });

  it('should record history entries with auto-generated IDs', async () => {
    history = makeHistory();

    const entry = await history.record({
      operation: 'insert',
      collection: 'todos',
      documentId: 'todo-1',
      before: null,
      after: { title: 'Buy groceries' },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.operation).toBe('insert');
    expect(entry.collection).toBe('todos');
    expect(entry.documentId).toBe('todo-1');
  });

  it('should generate unique IDs for different entries', async () => {
    history = makeHistory();

    const entry1 = await history.record({
      operation: 'insert',
      collection: 'todos',
      documentId: 'todo-1',
      before: null,
      after: { title: 'A' },
    });

    const entry2 = await history.record({
      operation: 'insert',
      collection: 'todos',
      documentId: 'todo-2',
      before: null,
      after: { title: 'B' },
    });

    expect(entry1.id).not.toBe(entry2.id);
  });

  it('should query entries by collection filter', async () => {
    history = makeHistory();

    await history.record({
      operation: 'insert',
      collection: 'todos',
      documentId: 'todo-1',
      before: null,
      after: { title: 'A' },
    });

    await history.record({
      operation: 'insert',
      collection: 'users',
      documentId: 'user-1',
      before: null,
      after: { name: 'Alice' },
    });

    const todoEntries = await history.getEntries({ collection: 'todos' });
    expect(todoEntries).toHaveLength(1);
    expect(todoEntries[0]!.collection).toBe('todos');

    const userEntries = await history.getEntries({ collection: 'users' });
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0]!.collection).toBe('users');
  });

  it('should query entries by operation filter', async () => {
    history = makeHistory();

    await history.record({
      operation: 'insert',
      collection: 'todos',
      documentId: 'todo-1',
      before: null,
      after: { title: 'A' },
    });

    await history.record({
      operation: 'update',
      collection: 'todos',
      documentId: 'todo-1',
      before: { title: 'A' },
      after: { title: 'B' },
    });

    await history.record({
      operation: 'delete',
      collection: 'todos',
      documentId: 'todo-1',
      before: { title: 'B' },
      after: null,
    });

    const inserts = await history.getEntries({ operation: 'insert' });
    expect(inserts).toHaveLength(1);

    const updates = await history.getEntries({ operation: 'update' });
    expect(updates).toHaveLength(1);

    const deletes = await history.getEntries({ operation: 'delete' });
    expect(deletes).toHaveLength(1);
  });

  it('should create and list snapshots', async () => {
    history = makeHistory();

    await history.record({
      operation: 'insert',
      collection: 'todos',
      documentId: 'todo-1',
      before: null,
      after: { title: 'A' },
    });

    const snapshot = await history.createSnapshot('before-migration');
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.label).toBe('before-migration');
    expect(snapshot.entries).toBe(1);
    expect(snapshot.collections).toContain('todos');

    const snapshots = await history.getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.id).toBe(snapshot.id);
  });

  it('should persist and restore via save/load', async () => {
    const storage = new MemoryHistoryStorage();
    history = createPersistentHistory({
      storage,
      namespace: 'test',
      autoSaveIntervalMs: 60_000,
    });

    await history.record({
      operation: 'insert',
      collection: 'todos',
      documentId: 'todo-1',
      before: null,
      after: { title: 'Persisted' },
    });
    await history.save();
    history.destroy();

    // Create a new instance with the same storage
    const history2 = createPersistentHistory({
      storage,
      namespace: 'test',
      autoSaveIntervalMs: 60_000,
    });
    await history2.load();

    const entries = await history2.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.after).toEqual({ title: 'Persisted' });
    history2.destroy();
  });
});

/* ================================================================== */
/*  AuditExporter                                                      */
/* ================================================================== */

describe('AuditExporter', () => {
  const sampleEntries: PersistentHistoryEntry[] = [
    makeEntry({ id: 'e1', timestamp: 1_700_000_000_000, operation: 'insert', collection: 'todos', documentId: 'doc-1' }),
    makeEntry({ id: 'e2', timestamp: 1_700_003_600_000, operation: 'update', collection: 'todos', documentId: 'doc-1', before: { title: 'Buy groceries' }, after: { title: 'Buy organic groceries' } }),
    makeEntry({ id: 'e3', timestamp: 1_700_007_200_000, operation: 'delete', collection: 'users', documentId: 'user-1', before: { name: 'Alice' }, after: null }),
  ];

  it('should export entries as JSON format', () => {
    const exporter = createAuditExporter();
    const report = exporter.export(sampleEntries, { format: 'json' });

    expect(report.totalEntries).toBe(3);
    expect(report.collections).toContain('todos');
    expect(report.collections).toContain('users');

    const parsed = JSON.parse(report.data) as unknown[];
    expect(parsed).toHaveLength(3);
  });

  it('should export entries as CSV format', () => {
    const exporter = new AuditExporter();
    const report = exporter.export(sampleEntries, { format: 'csv' });

    const lines = report.data.split('\n');
    // Header + 3 data rows
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('id,timestamp,operation,collection,documentId');
  });

  it('should export entries as NDJSON format', () => {
    const exporter = new AuditExporter();
    const report = exporter.export(sampleEntries, { format: 'ndjson' });

    const lines = report.data.split('\n');
    expect(lines).toHaveLength(3);

    // Each line should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('should generate summary with operation breakdown', () => {
    const exporter = new AuditExporter();
    const summary = exporter.generateSummary(sampleEntries);

    expect(summary.totalEntries).toBe(3);
    expect(summary.operationBreakdown.insert).toBe(1);
    expect(summary.operationBreakdown.update).toBe(1);
    expect(summary.operationBreakdown.delete).toBe(1);
    expect(summary.uniqueCollections).toBe(2);
    expect(summary.uniqueDocuments).toBe(2);
  });

  it('should calculate entries per hour in summary', () => {
    const exporter = new AuditExporter();
    const summary = exporter.generateSummary(sampleEntries);

    // Time span is 7200 seconds = 2 hours, so 3 entries / 2 hours = 1.5
    expect(summary.entriesPerHour).toBe(1.5);
    expect(summary.timeRange.start).toBe(1_700_000_000_000);
    expect(summary.timeRange.end).toBe(1_700_007_200_000);
  });

  it('should include date range in report', () => {
    const exporter = new AuditExporter();
    const report = exporter.export(sampleEntries, { format: 'json' });

    expect(report.dateRange.start).toBe(1_700_000_000_000);
    expect(report.dateRange.end).toBe(1_700_007_200_000);
  });

  it('should track operation counts in report', () => {
    const exporter = new AuditExporter();
    const report = exporter.export(sampleEntries, { format: 'json' });

    expect(report.operationCounts).toEqual({
      insert: 1,
      update: 1,
      delete: 1,
    });
  });
});
