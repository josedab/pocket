import { describe, it, expect, beforeEach } from 'vitest';
import { createSchemaInspector } from '../schema-inspector.js';
import { createProQueryPlayground } from '../query-playground.js';
import { createSyncDashboard } from '../sync-dashboard.js';
import { createDataInspector } from '../data-inspector.js';
import type { SchemaInspector } from '../schema-inspector.js';
import type { QueryPlayground } from '../query-playground.js';
import type { SyncDashboard } from '../sync-dashboard.js';
import type { DataInspector } from '../data-inspector.js';
import type { CollectionSchema } from '../types.js';
import { firstValueFrom } from 'rxjs';

// ── Schema Inspector ────────────────────────────────────────────────

describe('SchemaInspector', () => {
  let inspector: SchemaInspector;

  beforeEach(() => {
    inspector = createSchemaInspector();
  });

  it('should infer schema from sample documents', () => {
    const docs = [
      { _id: '1', name: 'Alice', age: 30, active: true },
      { _id: '2', name: 'Bob', age: 25, active: false },
    ];

    const schema = inspector.inspectCollection('users', docs);
    expect(schema.name).toBe('users');
    expect(schema.primaryKey).toBe('_id');
    expect(schema.fields.length).toBe(3);
    expect(schema.fields.find((f) => f.name === 'name')?.type).toBe('string');
    expect(schema.fields.find((f) => f.name === 'age')?.type).toBe('number');
    expect(schema.fields.find((f) => f.name === 'active')?.type).toBe('boolean');
  });

  it('should detect required fields', () => {
    const docs = [
      { _id: '1', name: 'Alice', email: 'a@test.com' },
      { _id: '2', name: 'Bob' },
    ];

    const schema = inspector.inspectCollection('users', docs);
    expect(schema.fields.find((f) => f.name === 'name')?.required).toBe(true);
    expect(schema.fields.find((f) => f.name === 'email')?.required).toBe(false);
  });

  it('should detect timestamps', () => {
    const docs = [{ _id: '1', createdAt: new Date(), title: 'Test' }];
    const schema = inspector.inspectCollection('posts', docs);
    expect(schema.timestamps).toBe(true);
  });

  it('should validate schema with duplicate fields', () => {
    const schema: CollectionSchema = {
      name: 'test',
      fields: [
        { name: 'a', type: 'string', required: true, indexed: false },
        { name: 'a', type: 'number', required: false, indexed: false },
      ],
      primaryKey: '_id',
      indexes: [],
      timestamps: false,
    };

    const errors = inspector.validateSchema(schema);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });

  it('should validate schema with no fields', () => {
    const schema: CollectionSchema = {
      name: 'empty',
      fields: [],
      primaryKey: '_id',
      indexes: [],
      timestamps: false,
    };

    const errors = inspector.validateSchema(schema);
    expect(errors.some((e) => e.severity === 'warning')).toBe(true);
  });

  it('should generate TypeScript interface', () => {
    const schema: CollectionSchema = {
      name: 'users',
      fields: [
        { name: 'name', type: 'string', required: true, indexed: false },
        { name: 'age', type: 'number', required: false, indexed: false },
      ],
      primaryKey: '_id',
      indexes: [],
      timestamps: false,
    };

    const ts = inspector.generateTypeScript(schema);
    expect(ts).toContain('export interface Users');
    expect(ts).toContain('name: string');
    expect(ts).toContain('age?: number');
  });

  it('should diff two schemas', () => {
    const a: CollectionSchema = {
      name: 'users',
      fields: [
        { name: 'name', type: 'string', required: true, indexed: false },
        { name: 'email', type: 'string', required: true, indexed: false },
      ],
      primaryKey: '_id',
      indexes: [],
      timestamps: false,
    };

    const b: CollectionSchema = {
      name: 'users',
      fields: [
        { name: 'name', type: 'string', required: false, indexed: false },
        { name: 'age', type: 'number', required: false, indexed: false },
      ],
      primaryKey: '_id',
      indexes: [],
      timestamps: false,
    };

    const diffs = inspector.diffSchemas(a, b);
    expect(diffs.some((d) => d.type === 'added' && d.field === 'age')).toBe(true);
    expect(diffs.some((d) => d.type === 'removed' && d.field === 'email')).toBe(true);
    expect(diffs.some((d) => d.type === 'changed' && d.field === 'name')).toBe(true);
  });

  it('should track all inspected schemas', () => {
    inspector.inspectCollection('users', [{ _id: '1', name: 'Alice' }]);
    inspector.inspectCollection('posts', [{ _id: '1', title: 'Hello' }]);

    const all = inspector.getAllSchemas();
    expect(all.length).toBe(2);
    expect(all.map((s) => s.name)).toContain('users');
    expect(all.map((s) => s.name)).toContain('posts');
  });
});

// ── Query Playground ────────────────────────────────────────────────

describe('QueryPlayground', () => {
  let playground: QueryPlayground;
  const docs = [
    { _id: '1', name: 'Alice', age: 30, active: true },
    { _id: '2', name: 'Bob', age: 25, active: false },
    { _id: '3', name: 'Charlie', age: 35, active: true },
  ];

  beforeEach(() => {
    playground = createProQueryPlayground({ maxHistoryEntries: 50 });
  });

  it('should execute a query with no filter', () => {
    const result = playground.execute({ collection: 'users' }, docs);
    expect(result.resultCount).toBe(3);
    expect(result.results.length).toBe(3);
  });

  it('should execute a query with equality filter', () => {
    const result = playground.execute({ collection: 'users', filter: { active: true } }, docs);
    expect(result.resultCount).toBe(2);
  });

  it('should execute a query with comparison operators', () => {
    const result = playground.execute(
      { collection: 'users', filter: { age: { $gt: 28 } } },
      docs,
    );
    expect(result.resultCount).toBe(2);
    expect(result.results.every((r) => (r as Record<string, unknown>)['age'] as number > 28)).toBe(true);
  });

  it('should respect limit', () => {
    const result = playground.execute({ collection: 'users', limit: 1 }, docs);
    expect(result.resultCount).toBe(1);
  });

  it('should track execution history', () => {
    playground.execute({ collection: 'users' }, docs);
    playground.execute({ collection: 'users', filter: { active: true } }, docs);

    const history = playground.getHistory();
    expect(history.length).toBe(2);
    expect(history[0]!.resultCount).toBe(2);
    expect(history[1]!.resultCount).toBe(3);
  });

  it('should clear history', () => {
    playground.execute({ collection: 'users' }, docs);
    expect(playground.getHistory().length).toBe(1);

    playground.clearHistory();
    expect(playground.getHistory().length).toBe(0);
  });

  it('should provide query explanation', () => {
    const explanation = playground.explain({ collection: 'users', filter: { name: 'Alice' } });
    expect(explanation.strategy).toBe('full-scan');
    expect(explanation.notes.length).toBeGreaterThan(0);
  });

  it('should expose reactive state', async () => {
    playground.execute({ collection: 'users' }, docs);

    const state = await firstValueFrom(playground.getState$());
    expect(state.results.length).toBe(3);
    expect(state.error).toBeNull();
    expect(state.history.length).toBe(1);
  });
});

// ── Sync Dashboard ──────────────────────────────────────────────────

describe('SyncDashboard', () => {
  let dashboard: SyncDashboard;

  beforeEach(() => {
    dashboard = createSyncDashboard({ maxHistoryEntries: 50 });
  });

  it('should record sync entries', () => {
    dashboard.recordSync({
      id: 's1',
      timestamp: new Date().toISOString(),
      direction: 'push',
      documentCount: 10,
      conflictCount: 0,
      durationMs: 150,
    });

    const history = dashboard.getHistory();
    expect(history.length).toBe(1);
    expect(history[0]!.documentCount).toBe(10);
  });

  it('should limit history by count', () => {
    dashboard.recordSync({
      id: 's1',
      timestamp: new Date().toISOString(),
      direction: 'push',
      documentCount: 5,
      conflictCount: 0,
      durationMs: 100,
    });
    dashboard.recordSync({
      id: 's2',
      timestamp: new Date().toISOString(),
      direction: 'pull',
      documentCount: 8,
      conflictCount: 1,
      durationMs: 200,
    });

    const limited = dashboard.getHistory(1);
    expect(limited.length).toBe(1);
  });

  it('should track peers', () => {
    dashboard.recordPeerUpdate({
      peerId: 'peer-1',
      status: 'connected',
      lastSyncAt: null,
      docsSynced: 0,
      latencyMs: 12,
    });

    const peers = dashboard.getPeers();
    expect(peers.length).toBe(1);
    expect(peers[0]!.peerId).toBe('peer-1');
    expect(peers[0]!.status).toBe('connected');
  });

  it('should update existing peer info', () => {
    dashboard.recordPeerUpdate({
      peerId: 'peer-1',
      status: 'connected',
      lastSyncAt: null,
      docsSynced: 0,
      latencyMs: 12,
    });
    dashboard.recordPeerUpdate({
      peerId: 'peer-1',
      status: 'syncing',
      lastSyncAt: new Date().toISOString(),
      docsSynced: 50,
      latencyMs: 8,
    });

    const peers = dashboard.getPeers();
    expect(peers.length).toBe(1);
    expect(peers[0]!.status).toBe('syncing');
    expect(peers[0]!.docsSynced).toBe(50);
  });

  it('should compute throughput', () => {
    dashboard.recordSync({
      id: 's1',
      timestamp: new Date().toISOString(),
      direction: 'push',
      documentCount: 100,
      conflictCount: 0,
      durationMs: 1000,
    });

    const throughput = dashboard.getThroughput();
    expect(throughput.docsPerSecond).toBeGreaterThan(0);
    expect(throughput.bytesPerSecond).toBeGreaterThan(0);
  });

  it('should expose reactive state', async () => {
    dashboard.recordPeerUpdate({
      peerId: 'peer-1',
      status: 'connected',
      lastSyncAt: null,
      docsSynced: 0,
      latencyMs: 10,
    });

    const state = await firstValueFrom(dashboard.getState$());
    expect(state.connected).toBe(true);
    expect(state.peers.length).toBe(1);
  });
});

// ── Data Inspector ──────────────────────────────────────────────────

describe('DataInspector', () => {
  let inspector: DataInspector;
  const docs = [
    { _id: '1', name: 'Alice', email: 'alice@test.com', age: 30 },
    { _id: '2', name: 'Bob', email: 'bob@test.com', age: 25 },
    { _id: '3', name: 'Charlie', email: 'charlie@test.com', age: 35 },
    { _id: '4', name: 'Diana', email: 'diana@test.com', age: 28 },
    { _id: '5', name: 'Eve', email: 'eve@test.com', age: 32 },
  ];

  beforeEach(() => {
    inspector = createDataInspector();
  });

  it('should paginate documents', () => {
    const state = inspector.inspect('users', docs, 0, 2);
    expect(state.collection).toBe('users');
    expect(state.documents.length).toBe(2);
    expect(state.totalCount).toBe(5);
    expect(state.page).toBe(0);
    expect(state.pageSize).toBe(2);
  });

  it('should return correct page', () => {
    const state = inspector.inspect('users', docs, 1, 2);
    expect(state.documents.length).toBe(2);
    expect((state.documents[0] as Record<string, unknown>)['_id']).toBe('3');
  });

  it('should handle last page with fewer items', () => {
    const state = inspector.inspect('users', docs, 2, 2);
    expect(state.documents.length).toBe(1);
  });

  it('should search across string fields', () => {
    const results = inspector.search('users', docs, 'alice');
    expect(results.length).toBe(1);
    expect((results[0] as Record<string, unknown>)['name']).toBe('Alice');
  });

  it('should search case-insensitively', () => {
    const results = inspector.search('users', docs, 'BOB');
    expect(results.length).toBe(1);
  });

  it('should get document by id', () => {
    const doc = inspector.getDocumentById('users', docs, '3');
    expect(doc).not.toBeNull();
    expect(doc!['name']).toBe('Charlie');
  });

  it('should return null for missing document', () => {
    const doc = inspector.getDocumentById('users', docs, 'nonexistent');
    expect(doc).toBeNull();
  });

  it('should compute collection stats', () => {
    const stats = inspector.getCollectionStats('users', docs);
    expect(stats.count).toBe(5);
    expect(stats.avgDocSize).toBeGreaterThan(0);
    expect(stats.fields).toContain('name');
    expect(stats.fields).toContain('email');
    expect(stats.fields).toContain('_id');
  });

  it('should export as JSON', () => {
    const json = inspector.exportData('users', docs.slice(0, 1), 'json');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('Alice');
  });

  it('should export as CSV', () => {
    const csv = inspector.exportData('users', docs.slice(0, 2), 'csv');
    const lines = csv.split('\n');
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0]).toContain('name');
    expect(lines[1]).toContain('Alice');
  });

  it('should handle empty export', () => {
    const csv = inspector.exportData('users', [], 'csv');
    expect(csv).toBe('');

    const json = inspector.exportData('users', [], 'json');
    expect(json).toBe('[]');
  });
});
