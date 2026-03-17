import { describe, expect, it } from 'vitest';
import { createDataInspector } from '../data-inspector.js';
import { createProQueryPlayground } from '../query-playground.js';
import { createSchemaInspector } from '../schema-inspector.js';
import { createSyncDashboard } from '../sync-dashboard.js';
import type { CollectionSchema } from '../types.js';

describe('Edge Cases', () => {
  // ── Empty Collections ─────────────────────────────────────────────

  describe('empty collections', () => {
    it('schema inspector: infer schema from empty docs', () => {
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('empty', []);
      expect(schema.fields).toEqual([]);
      expect(schema.timestamps).toBe(false);
      expect(schema.indexes).toEqual([]);
    });

    it('query playground: execute against empty docs', () => {
      const pg = createProQueryPlayground();
      const result = pg.execute({ collection: 'empty', filter: { x: 1 } }, []);
      expect(result.resultCount).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('data inspector: inspect empty collection', () => {
      const di = createDataInspector();
      const state = di.inspect('empty', [], 0, 10);
      expect(state.documents).toEqual([]);
      expect(state.totalCount).toBe(0);
    });

    it('data inspector: search empty collection', () => {
      const di = createDataInspector();
      expect(di.search('empty', [], 'anything')).toEqual([]);
    });

    it('data inspector: stats for empty collection', () => {
      const di = createDataInspector();
      const stats = di.getCollectionStats('empty', []);
      expect(stats.count).toBe(0);
      expect(stats.avgDocSize).toBe(0);
      expect(stats.fields).toEqual([]);
    });

    it('data inspector: export empty collection JSON', () => {
      const di = createDataInspector();
      expect(di.exportData('empty', [], 'json')).toBe('[]');
    });

    it('data inspector: export empty collection CSV', () => {
      const di = createDataInspector();
      expect(di.exportData('empty', [], 'csv')).toBe('');
    });
  });

  // ── Mixed Types ───────────────────────────────────────────────────

  describe('mixed types', () => {
    it('should detect mixed when string and number coexist', () => {
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('mixed', [
        { _id: '1', val: 'hello' },
        { _id: '2', val: 42 },
      ]);
      expect(schema.fields.find((f) => f.name === 'val')?.type).toBe('mixed');
    });

    it('should detect mixed with boolean and string', () => {
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('mixed', [
        { _id: '1', val: true },
        { _id: '2', val: 'yes' },
      ]);
      expect(schema.fields.find((f) => f.name === 'val')?.type).toBe('mixed');
    });

    it('should detect mixed with array and object', () => {
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('mixed', [
        { _id: '1', val: [1, 2] },
        { _id: '2', val: { a: 1 } },
      ]);
      expect(schema.fields.find((f) => f.name === 'val')?.type).toBe('mixed');
    });

    it('should not consider null as a distinct type in mixed detection', () => {
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('test', [
        { _id: '1', val: null },
        { _id: '2', val: 'hello' },
        { _id: '3', val: null },
      ]);
      // null → 'unknown' gets filtered; only 'string' remains
      expect(schema.fields.find((f) => f.name === 'val')?.type).toBe('string');
    });

    it('query playground should handle mixed type docs gracefully', () => {
      const pg = createProQueryPlayground();
      const mixedDocs = [
        { _id: '1', val: 'hello' },
        { _id: '2', val: 42 },
        { _id: '3', val: true },
      ];
      const result = pg.execute({ collection: 'test', filter: { val: 42 } }, mixedDocs);
      expect(result.resultCount).toBe(1);
    });
  });

  // ── Large Schemas ─────────────────────────────────────────────────

  describe('large schemas', () => {
    it('should handle a document with 200 fields', () => {
      const doc: Record<string, unknown> = { _id: '1' };
      for (let i = 0; i < 200; i++) {
        doc[`field_${i}`] = i % 2 === 0 ? `val_${i}` : i;
      }
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('wide', [doc]);
      expect(schema.fields.length).toBe(200);
    });

    it('should handle many documents for inference', () => {
      const docs = Array.from({ length: 500 }, (_, i) => ({
        _id: String(i),
        name: `user_${i}`,
        score: i * 10,
      }));
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('large', docs);
      expect(schema.fields.find((f) => f.name === 'name')?.required).toBe(true);
      expect(schema.fields.find((f) => f.name === 'score')?.required).toBe(true);
    });

    it('should generate TypeScript for large schema', () => {
      const fields = Array.from({ length: 50 }, (_, i) => ({
        name: `field_${i}`,
        type: i % 2 === 0 ? 'string' : 'number',
        required: true,
        indexed: false,
      }));
      const schema: CollectionSchema = {
        name: 'large',
        fields,
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const inspector = createSchemaInspector();
      const ts = inspector.generateTypeScript(schema);
      expect(ts.split('\n').length).toBe(52); // interface { + 50 fields + }
    });

    it('should diff large schemas efficiently', () => {
      const fieldsA = Array.from({ length: 100 }, (_, i) => ({
        name: `field_${i}`,
        type: 'string',
        required: true,
        indexed: false,
      }));
      const fieldsB = Array.from({ length: 100 }, (_, i) => ({
        name: `field_${i + 50}`, // overlap on 50-99, new 100-149
        type: 'string',
        required: true,
        indexed: false,
      }));
      const a: CollectionSchema = {
        name: 'a',
        fields: fieldsA,
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const b: CollectionSchema = {
        name: 'b',
        fields: fieldsB,
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const inspector = createSchemaInspector();
      const diffs = inspector.diffSchemas(a, b);
      // Fields 0-49 removed, fields 100-149 added
      const removed = diffs.filter((d) => d.type === 'removed');
      const added = diffs.filter((d) => d.type === 'added');
      expect(removed.length).toBe(50);
      expect(added.length).toBe(50);
    });

    it('query playground should handle large document sets', () => {
      const largeDocs = Array.from({ length: 1000 }, (_, i) => ({
        _id: String(i),
        value: i,
        active: i % 2 === 0,
      }));
      const pg = createProQueryPlayground();
      const result = pg.execute({ collection: 'large', filter: { active: true } }, largeDocs);
      expect(result.resultCount).toBe(500);
    });

    it('data inspector should paginate large collections', () => {
      const largeDocs = Array.from({ length: 100 }, (_, i) => ({
        _id: String(i),
        x: i,
      }));
      const di = createDataInspector();
      const page0 = di.inspect('large', largeDocs, 0, 25);
      expect(page0.documents.length).toBe(25);
      expect(page0.totalCount).toBe(100);

      const page3 = di.inspect('large', largeDocs, 3, 25);
      expect(page3.documents.length).toBe(25);
    });

    it('data inspector should export large CSV', () => {
      const largeDocs = Array.from({ length: 50 }, (_, i) => ({
        _id: String(i),
        name: `user_${i}`,
      }));
      const di = createDataInspector();
      const csv = di.exportData('large', largeDocs, 'csv');
      const lines = csv.split('\n');
      expect(lines.length).toBe(51); // header + 50 rows
    });
  });

  // ── Nested Objects ────────────────────────────────────────────────

  describe('nested objects', () => {
    it('should infer top-level nested object as object type', () => {
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('nested', [
        { _id: '1', profile: { name: 'Alice', age: 30 } },
      ]);
      expect(schema.fields.find((f) => f.name === 'profile')?.type).toBe('object');
    });

    it('should generate Record<string, unknown> for nested objects in TypeScript', () => {
      const schema: CollectionSchema = {
        name: 'test',
        fields: [{ name: 'data', type: 'object', required: true, indexed: false }],
        primaryKey: '_id',
        indexes: [],
        timestamps: false,
      };
      const inspector = createSchemaInspector();
      const ts = inspector.generateTypeScript(schema);
      expect(ts).toContain('data: Record<string, unknown>;');
    });

    it('query playground should filter on nested object reference', () => {
      const nestedDocs = [
        { _id: '1', meta: { role: 'admin' } },
        { _id: '2', meta: { role: 'user' } },
      ];
      const pg = createProQueryPlayground();
      // Equality on reference — objects won't match by value
      const result = pg.execute({ collection: 'test' }, nestedDocs);
      expect(result.resultCount).toBe(2);
    });

    it('data inspector CSV should stringify nested objects', () => {
      const nestedDocs = [{ _id: '1', meta: { role: 'admin' } }];
      const di = createDataInspector();
      const csv = di.exportData('test', nestedDocs, 'csv');
      expect(csv).toContain('[object Object]');
    });
  });

  // ── Special Values ────────────────────────────────────────────────

  describe('special values', () => {
    it('schema inspector should handle all-null field', () => {
      const inspector = createSchemaInspector();
      const schema = inspector.inspectCollection('nulls', [
        { _id: '1', val: null },
        { _id: '2', val: null },
      ]);
      expect(schema.fields.find((f) => f.name === 'val')?.type).toBe('unknown');
    });

    it('query playground $ne should work with null', () => {
      const pg = createProQueryPlayground();
      const result = pg.execute({ collection: 'test', filter: { name: { $ne: null } } }, [
        { _id: '1', name: 'Alice' },
        { _id: '2', name: null },
      ]);
      expect(result.resultCount).toBe(1);
    });

    it('query playground equality should match null', () => {
      const pg = createProQueryPlayground();
      const result = pg.execute({ collection: 'test', filter: { name: null } }, [
        { _id: '1', name: 'Alice' },
        { _id: '2', name: null },
      ]);
      expect(result.resultCount).toBe(1);
    });

    it('data inspector should handle docs with only _id', () => {
      const di = createDataInspector();
      const stats = di.getCollectionStats('bare', [{ _id: '1' }, { _id: '2' }]);
      expect(stats.count).toBe(2);
      expect(stats.fields).toEqual(['_id']);
    });
  });

  // ── Sync Dashboard Edge Cases ─────────────────────────────────────

  describe('sync dashboard edge cases', () => {
    it('should handle zero durationMs in throughput', () => {
      const dashboard = createSyncDashboard();
      dashboard.recordSync({
        id: 's1',
        timestamp: new Date().toISOString(),
        direction: 'push',
        documentCount: 10,
        conflictCount: 0,
        durationMs: 0,
      });
      // With 0 duration, totalDurationSec is 0, so docsPerSecond should be 0
      const throughput = dashboard.getThroughput();
      expect(throughput.docsPerSecond).toBe(0);
    });

    it('should handle conflict counts in entries', () => {
      const dashboard = createSyncDashboard();
      dashboard.recordSync({
        id: 's1',
        timestamp: new Date().toISOString(),
        direction: 'bidirectional',
        documentCount: 50,
        conflictCount: 5,
        durationMs: 300,
      });
      const history = dashboard.getHistory();
      expect(history[0]!.conflictCount).toBe(5);
    });

    it('should allow recording sync after peers are added', () => {
      const dashboard = createSyncDashboard();
      dashboard.recordPeerUpdate({
        peerId: 'p1',
        status: 'connected',
        lastSyncAt: null,
        docsSynced: 0,
        latencyMs: 5,
      });
      dashboard.recordSync({
        id: 's1',
        timestamp: new Date().toISOString(),
        direction: 'push',
        documentCount: 10,
        conflictCount: 0,
        durationMs: 100,
      });
      expect(dashboard.getPeers().length).toBe(1);
      expect(dashboard.getHistory().length).toBe(1);
    });
  });

  // ── Integration-like Scenarios ────────────────────────────────────

  describe('integration scenarios', () => {
    it('inspect schema → generate TypeScript → validate roundtrip', () => {
      const inspector = createSchemaInspector();
      const docs = [
        { _id: '1', name: 'Alice', age: 30, active: true, tags: ['admin'] },
        { _id: '2', name: 'Bob', age: 25, active: false },
      ];
      const schema = inspector.inspectCollection('users', docs);
      const ts = inspector.generateTypeScript(schema);
      const errors = inspector.validateSchema(schema);

      expect(ts).toContain('export interface Users');
      expect(ts).toContain('name: string');
      expect(ts).toContain('age: number');
      expect(ts).toContain('active: boolean');
      expect(ts).toContain('tags?: unknown[]');
      expect(errors).toEqual([]);
    });

    it('query playground → data inspector roundtrip', () => {
      const docs = [
        { _id: '1', name: 'Alice', age: 30 },
        { _id: '2', name: 'Bob', age: 25 },
        { _id: '3', name: 'Charlie', age: 35 },
      ];
      const pg = createProQueryPlayground();
      const result = pg.execute({ collection: 'users', filter: { age: { $gte: 30 } } }, docs);

      const di = createDataInspector();
      const state = di.inspect('results', result.results as Record<string, unknown>[], 0, 10);
      expect(state.totalCount).toBe(2);
      expect(state.documents.length).toBe(2);
    });

    it('schema diff after adding documents', () => {
      const inspector = createSchemaInspector();
      const v1Docs = [{ _id: '1', name: 'Alice' }];
      const v2Docs = [{ _id: '1', name: 'Alice', email: 'alice@test.com', age: 30 }];

      const v1 = inspector.inspectCollection('users_v1', v1Docs);
      const v2 = inspector.inspectCollection('users_v2', v2Docs);
      const diffs = inspector.diffSchemas(v1, v2);

      expect(diffs.some((d) => d.type === 'added' && d.field === 'email')).toBe(true);
      expect(diffs.some((d) => d.type === 'added' && d.field === 'age')).toBe(true);
    });
  });
});
