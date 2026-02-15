import { describe, expect, it } from 'vitest';
import {
  createCompetitorImporter,
  createFormatDetector,
  createStreamingExporter,
} from '../index.js';
import type { CollectionExport } from '../types.js';

// ---- Test Data ----

const sampleCollections: CollectionExport[] = [
  {
    name: 'users',
    documents: [
      { id: '1', name: 'Alice', age: 30 },
      { id: '2', name: 'Bob', age: 25 },
    ],
  },
  {
    name: 'posts',
    documents: [{ id: 'p1', title: 'Hello', author: '1' }],
  },
];

// ---- Competitor Import: RxDB ----

describe('createCompetitorImporter', () => {
  const importer = createCompetitorImporter();

  describe('RxDB import', () => {
    it('should import RxDB export format', () => {
      const rxdbData = JSON.stringify({
        instanceToken: 'test-token',
        collections: {
          users: {
            name: 'users',
            schemaHash: 'abc123',
            docs: [
              { _id: 'u1', name: 'Alice', _rev: '1-abc', _deleted: false },
              { _id: 'u2', name: 'Bob', _rev: '2-def', _deleted: false },
            ],
          },
        },
      });

      const result = importer.importFromRxDB(rxdbData);

      expect(result.sourceFormat).toBe('rxdb');
      expect(result.imported).toBe(2);
      expect(result.collections).toContain('users');
      expect(result.convertedCollections).toHaveLength(1);
      expect(result.convertedCollections[0].documents[0]).toHaveProperty('id', 'u1');
      // Internal RxDB fields should be stripped
      expect(result.convertedCollections[0].documents[0]).not.toHaveProperty('_rev');
    });

    it('should handle empty RxDB export', () => {
      const result = importer.importFromRxDB(JSON.stringify({ collections: {} }));
      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle malformed RxDB data', () => {
      const result = importer.importFromRxDB('not json');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('PouchDB import', () => {
    it('should import PouchDB all_docs format', () => {
      const pouchData = JSON.stringify({
        db_name: 'mydb',
        total_rows: 2,
        rows: [
          {
            id: 'u1',
            key: 'u1',
            value: { rev: '1-abc' },
            doc: { _id: 'u1', _rev: '1-abc', name: 'Alice' },
          },
          {
            id: 'u2',
            key: 'u2',
            value: { rev: '1-def' },
            doc: { _id: 'u2', _rev: '1-def', name: 'Bob' },
          },
        ],
      });

      const result = importer.importFromPouchDB(pouchData);

      expect(result.sourceFormat).toBe('pouchdb');
      expect(result.imported).toBe(2);
      expect(result.collections).toContain('mydb');
      // _rev should be stripped
      expect(result.convertedCollections[0].documents[0]).not.toHaveProperty('_rev');
      expect(result.convertedCollections[0].documents[0]).toHaveProperty('id', 'u1');
    });

    it('should skip design documents', () => {
      const pouchData = JSON.stringify({
        db_name: 'mydb',
        total_rows: 2,
        rows: [
          { id: '_design/views', doc: { _id: '_design/views', views: {} } },
          { id: 'u1', doc: { _id: 'u1', name: 'Alice' } },
        ],
      });

      const result = importer.importFromPouchDB(pouchData);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  describe('Firestore import', () => {
    it('should import Firestore export format', () => {
      const firestoreData = JSON.stringify({
        documents: [
          {
            name: 'projects/myapp/databases/(default)/documents/users/u1',
            fields: {
              name: { stringValue: 'Alice' },
              age: { integerValue: '30' },
              active: { booleanValue: true },
            },
            createTime: '2024-01-01T00:00:00Z',
          },
        ],
      });

      const result = importer.importFromFirestore(firestoreData);

      expect(result.sourceFormat).toBe('firestore');
      expect(result.imported).toBe(1);
      const doc = result.convertedCollections[0].documents[0];
      expect(doc).toHaveProperty('name', 'Alice');
      expect(doc).toHaveProperty('age', 30);
      expect(doc).toHaveProperty('active', true);
      expect(doc).toHaveProperty('id', 'u1');
    });

    it('should handle Firestore collections format', () => {
      const data = JSON.stringify({
        collections: {
          users: {
            documents: [{ name: 'users/u1', fields: { name: { stringValue: 'Alice' } } }],
          },
          posts: {
            documents: [{ name: 'posts/p1', fields: { title: { stringValue: 'Hello' } } }],
          },
        },
      });

      const result = importer.importFromFirestore(data);
      expect(result.imported).toBe(2);
      expect(result.collections).toContain('users');
      expect(result.collections).toContain('posts');
    });
  });

  describe('Auto-detection', () => {
    it('should detect and import RxDB format', () => {
      const data = JSON.stringify({
        instanceToken: 'test',
        collections: { users: { schemaHash: 'abc', docs: [{ _id: 'u1', name: 'Alice' }] } },
      });
      const result = importer.importAuto(data);
      expect(result.sourceFormat).toBe('rxdb');
      expect(result.imported).toBe(1);
    });

    it('should detect and import PouchDB format', () => {
      const data = JSON.stringify({
        db_name: 'test',
        total_rows: 1,
        rows: [{ id: 'u1', doc: { _id: 'u1', name: 'Alice' } }],
      });
      const result = importer.importAuto(data);
      expect(result.sourceFormat).toBe('pouchdb');
      expect(result.imported).toBe(1);
    });

    it('should return unknown for unrecognized format', () => {
      const result = importer.importAuto('just a plain string');
      expect(result.sourceFormat).toBe('unknown');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

// ---- Streaming Export ----

describe('createStreamingExporter', () => {
  const streamer = createStreamingExporter();

  it('should stream JSON export', async () => {
    const chunks: string[] = [];
    for await (const chunk of streamer.exportJsonStream(sampleCollections, { chunkSize: 1 })) {
      chunks.push(chunk);
    }

    const fullJson = chunks.join('');
    const parsed = JSON.parse(fullJson) as Record<string, unknown>;
    expect(parsed).toHaveProperty('version', '1.0.0');
    expect(parsed).toHaveProperty('collections');
    expect((parsed.collections as unknown[]).length).toBe(2);
  });

  it('should stream NDJSON export', async () => {
    const chunks: string[] = [];
    for await (const chunk of streamer.exportNdjsonStream(sampleCollections, { chunkSize: 1 })) {
      chunks.push(chunk);
    }

    const allLines = chunks.join('').trim().split('\n');
    expect(allLines).toHaveLength(3); // 2 users + 1 post
    for (const line of allLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('should stream CSV export', async () => {
    const chunks: string[] = [];
    for await (const chunk of streamer.exportCsvStream(sampleCollections[0], { chunkSize: 1 })) {
      chunks.push(chunk);
    }

    const fullCsv = chunks.join('');
    const lines = fullCsv.trim().split('\n');
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('name');
    expect(lines.length).toBe(3); // header + 2 data rows
  });

  it('should handle empty collections', async () => {
    const chunks: string[] = [];
    for await (const chunk of streamer.exportCsvStream({ name: 'empty', documents: [] })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });
});

// ---- Format Detector ----

describe('createFormatDetector', () => {
  const detector = createFormatDetector();

  it('should detect Pocket JSON format', () => {
    const data = JSON.stringify({ version: '1.0.0', collections: [] });
    const result = detector.detect(data);
    expect(result).toEqual({ type: 'pocket', format: 'json' });
  });

  it('should detect SQL format', () => {
    const result = detector.detect('CREATE TABLE users (id TEXT);');
    expect(result).toEqual({ type: 'pocket', format: 'sql' });
  });

  it('should detect NDJSON format', () => {
    const data = '{"a":1}\n{"b":2}\n{"c":3}';
    const result = detector.detect(data);
    expect(result).toEqual({ type: 'pocket', format: 'ndjson' });
  });

  it('should detect CSV format', () => {
    const data = 'id,name,age\n1,Alice,30\n2,Bob,25';
    const result = detector.detect(data);
    expect(result).toEqual({ type: 'pocket', format: 'csv' });
  });

  it('should detect RxDB format', () => {
    const data = JSON.stringify({ instanceToken: 'abc', collections: {} });
    const result = detector.detect(data);
    expect(result).toEqual({ type: 'competitor', format: 'rxdb' });
  });

  it('should detect PouchDB format', () => {
    const data = JSON.stringify({ db_name: 'test', total_rows: 0, rows: [] });
    const result = detector.detect(data);
    expect(result).toEqual({ type: 'competitor', format: 'pouchdb' });
  });

  it('should detect Firestore format', () => {
    const data = JSON.stringify({
      documents: [{ name: 'users/u1', fields: { name: { stringValue: 'Alice' } } }],
    });
    const result = detector.detect(data);
    expect(result).toEqual({ type: 'competitor', format: 'firestore' });
  });

  it('should return unknown for empty data', () => {
    expect(detector.detect('')).toEqual({ type: 'unknown' });
  });
});
