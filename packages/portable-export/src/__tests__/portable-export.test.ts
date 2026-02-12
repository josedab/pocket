import { describe, it, expect } from 'vitest';
import {
  createJsonExporter,
  createCsvExporter,
  createSqlExporter,
  createNdjsonExporter,
  createImporter,
  createIntegrityChecker,
  createExportManager,
} from '../index.js';
import type { CollectionExport, DatabaseSnapshot, ExportProgress } from '../types.js';

// ---- Test Data ----

const sampleCollections: CollectionExport[] = [
  {
    name: 'users',
    documents: [
      { id: '1', name: 'Alice', age: 30, active: true },
      { id: '2', name: 'Bob', age: 25, active: false },
    ],
  },
  {
    name: 'posts',
    documents: [
      { id: 'p1', title: 'Hello World', author: '1', tags: ['intro', 'welcome'] },
      { id: 'p2', title: 'Second Post', author: '2', tags: ['update'] },
    ],
  },
];

// ---- JSON Exporter ----

describe('createJsonExporter', () => {
  const exporter = createJsonExporter();

  it('should export collections as JSON', () => {
    const result = exporter.export(sampleCollections);
    const parsed = JSON.parse(result) as DatabaseSnapshot;

    expect(parsed.version).toBe('1.0.0');
    expect(parsed.collections).toHaveLength(2);
    expect(parsed.collections[0].name).toBe('users');
    expect(parsed.collections[0].documents).toHaveLength(2);
    expect(parsed.exportedAt).toBeDefined();
  });

  it('should support pretty-print', () => {
    const compact = exporter.export(sampleCollections);
    const pretty = exporter.export(sampleCollections, { prettyPrint: true });

    expect(pretty.length).toBeGreaterThan(compact.length);
    expect(pretty).toContain('\n');
  });

  it('should include metadata by default', () => {
    const result = exporter.export(sampleCollections);
    const parsed = JSON.parse(result) as DatabaseSnapshot;

    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata?.format).toBe('pocket-export');
  });

  it('should exclude metadata when configured', () => {
    const result = exporter.export(sampleCollections, { includeMetadata: false });
    const parsed = JSON.parse(result) as DatabaseSnapshot;

    expect(parsed.metadata).toBeUndefined();
  });

  it('should export a single collection', () => {
    const docs = [{ id: '1', name: 'Test' }];
    const result = exporter.exportCollection('test', docs);
    const parsed = JSON.parse(result) as CollectionExport;

    expect(parsed.name).toBe('test');
    expect(parsed.documents).toHaveLength(1);
  });
});

// ---- JSON Round-Trip ----

describe('JSON round-trip', () => {
  it('should export and import preserving data', () => {
    const exporter = createJsonExporter();
    const importer = createImporter();

    const exported = exporter.export(sampleCollections);
    const result = importer.importJson(exported);

    expect(result.imported).toBe(4);
    expect(result.errors).toHaveLength(0);
    expect(result.collections).toContain('users');
    expect(result.collections).toContain('posts');
  });
});

// ---- CSV Exporter ----

describe('createCsvExporter', () => {
  const exporter = createCsvExporter();

  it('should export collection as CSV', () => {
    const result = exporter.export(sampleCollections[0]);
    const lines = result.split('\n');

    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('name');
    expect(lines[0]).toContain('age');
    expect(lines).toHaveLength(3); // header + 2 docs
  });

  it('should handle nested objects by flattening', () => {
    const collection: CollectionExport = {
      name: 'nested',
      documents: [
        { id: '1', address: { city: 'NYC', zip: '10001' } },
      ],
    };
    const result = exporter.export(collection);

    expect(result).toContain('address.city');
    expect(result).toContain('address.zip');
    expect(result).toContain('NYC');
  });

  it('should handle special characters in values', () => {
    const collection: CollectionExport = {
      name: 'special',
      documents: [
        { id: '1', description: 'Hello, "World"' },
        { id: '2', description: 'Line1\nLine2' },
      ],
    };
    const result = exporter.export(collection);

    expect(result).toContain('"Hello, ""World"""');
    expect(result).toContain('"Line1\nLine2"');
  });

  it('should support custom delimiter', () => {
    const result = exporter.export(sampleCollections[0], { delimiter: ';' });

    expect(result.split('\n')[0]).toContain(';');
  });

  it('should handle arrays in documents', () => {
    const result = exporter.export(sampleCollections[1]);

    // Arrays are serialized as JSON strings
    expect(result).toContain('intro');
  });

  it('should return empty string for empty collection', () => {
    const collection: CollectionExport = { name: 'empty', documents: [] };
    const result = exporter.export(collection);

    expect(result).toBe('');
  });
});

// ---- SQL Exporter ----

describe('createSqlExporter', () => {
  const exporter = createSqlExporter();

  it('should generate CREATE TABLE statements', () => {
    const result = exporter.export(sampleCollections);

    expect(result).toContain('CREATE TABLE IF NOT EXISTS');
    expect(result).toContain('"users"');
    expect(result).toContain('"posts"');
  });

  it('should generate INSERT statements', () => {
    const result = exporter.export(sampleCollections);

    expect(result).toContain('INSERT INTO');
    expect(result).toContain("'Alice'");
    expect(result).toContain("'Bob'");
  });

  it('should infer correct SQL types', () => {
    const result = exporter.export([sampleCollections[0]]);

    // age is number -> INTEGER, name is string -> TEXT
    expect(result).toContain('"age" INTEGER');
    expect(result).toContain('"name" TEXT');
    expect(result).toContain('"active" INTEGER');
  });

  it('should handle null values', () => {
    const collection: CollectionExport = {
      name: 'nullable',
      documents: [
        { id: '1', value: null },
        { id: '2', value: 'test' },
      ],
    };
    const result = exporter.export([collection]);

    expect(result).toContain('NULL');
  });

  it('should handle empty collections', () => {
    const collection: CollectionExport = { name: 'empty', documents: [] };
    const result = exporter.export([collection]);

    expect(result).toContain('CREATE TABLE IF NOT EXISTS');
    expect(result).not.toContain('INSERT INTO');
  });
});

// ---- NDJSON Exporter ----

describe('createNdjsonExporter', () => {
  const exporter = createNdjsonExporter();

  it('should export as newline-delimited JSON', () => {
    const result = exporter.export(sampleCollections);
    const lines = result.split('\n');

    expect(lines).toHaveLength(4); // 2 users + 2 posts
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('should include collection name in each record', () => {
    const result = exporter.export(sampleCollections);
    const lines = result.split('\n');
    const firstRecord = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(firstRecord._collection).toBe('users');
  });
});

// ---- NDJSON Round-Trip ----

describe('NDJSON round-trip', () => {
  it('should export and import preserving data', () => {
    const exporter = createNdjsonExporter();
    const importer = createImporter();

    const exported = exporter.export(sampleCollections);
    const result = importer.importNdjson(exported);

    expect(result.imported).toBe(4);
    expect(result.errors).toHaveLength(0);
    expect(result.collections).toContain('users');
    expect(result.collections).toContain('posts');
  });
});

// ---- Importer ----

describe('createImporter', () => {
  const importer = createImporter();

  it('should import valid JSON', () => {
    const data = JSON.stringify({
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collections: sampleCollections,
    });
    const result = importer.importJson(data);

    expect(result.imported).toBe(4);
    expect(result.collections).toEqual(['users', 'posts']);
  });

  it('should handle malformed JSON', () => {
    const result = importer.importJson('not valid json {{{');

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('JSON parse error');
  });

  it('should handle JSON with missing collections', () => {
    const result = importer.importJson(JSON.stringify({ version: '1.0.0' }));

    expect(result.imported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('missing collections');
  });

  it('should import CSV data', () => {
    const csv = 'id,name,age\n1,Alice,30\n2,Bob,25';
    const result = importer.importCsv(csv, 'users');

    expect(result.imported).toBe(2);
    expect(result.collections).toEqual(['users']);
  });

  it('should handle CSV column mismatch', () => {
    const csv = 'id,name,age\n1,Alice\n2,Bob,25';
    const result = importer.importCsv(csv, 'users');

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Column count mismatch');
    expect(result.imported).toBe(1);
  });

  it('should import NDJSON data', () => {
    const ndjson = '{"_collection":"users","id":"1","name":"Alice"}\n{"_collection":"users","id":"2","name":"Bob"}';
    const result = importer.importNdjson(ndjson);

    expect(result.imported).toBe(2);
    expect(result.collections).toContain('users');
  });

  it('should handle malformed NDJSON lines', () => {
    const ndjson = '{"_collection":"users","id":"1"}\nnot valid json\n{"_collection":"users","id":"2"}';
    const result = importer.importNdjson(ndjson);

    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
  });

  it('should validate JSON format', () => {
    const valid = JSON.stringify({
      version: '1.0.0',
      collections: [],
    });
    const result = importer.validate(valid, 'json');

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should report validation errors for invalid JSON', () => {
    const result = importer.validate('not json', 'json');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid JSON');
  });

  it('should validate NDJSON format', () => {
    const valid = '{"a":1}\n{"b":2}';
    const invalid = '{"a":1}\nnot json\n{"b":2}';

    expect(importer.validate(valid, 'ndjson').valid).toBe(true);
    expect(importer.validate(invalid, 'ndjson').valid).toBe(false);
  });
});

// ---- Integrity Checker ----

describe('createIntegrityChecker', () => {
  const checker = createIntegrityChecker();

  it('should generate consistent checksums', () => {
    const data = 'test data for checksum';
    const checksum1 = checker.generateChecksum(data);
    const checksum2 = checker.generateChecksum(data);

    expect(checksum1).toBe(checksum2);
    expect(typeof checksum1).toBe('string');
    expect(checksum1.length).toBeGreaterThan(0);
  });

  it('should generate different checksums for different data', () => {
    const checksum1 = checker.generateChecksum('data one');
    const checksum2 = checker.generateChecksum('data two');

    expect(checksum1).not.toBe(checksum2);
  });

  it('should verify checksum correctly', () => {
    const data = 'verify this data';
    const checksum = checker.generateChecksum(data);

    expect(checker.verify(data, checksum)).toBe(true);
    expect(checker.verify(data, 'wrong-checksum')).toBe(false);
    expect(checker.verify('modified data', checksum)).toBe(false);
  });

  it('should compute stats for a snapshot', () => {
    const snapshot: DatabaseSnapshot = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      collections: sampleCollections,
    };
    const stats = checker.computeStats(snapshot);

    expect(stats.documentCount).toBe(4);
    expect(stats.checksum).toBeDefined();
    expect(stats.valid).toBe(true);
  });
});

// ---- Export Manager ----

describe('createExportManager', () => {
  it('should export as JSON by default', () => {
    const manager = createExportManager();
    const result = manager.export(sampleCollections);

    expect(result.format).toBe('json');
    expect(result.collectionCount).toBe(2);
    expect(result.documentCount).toBe(4);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.checksum).toBeDefined();
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.exportedAt).toBeDefined();
  });

  it('should export as CSV', () => {
    const manager = createExportManager();
    const result = manager.export(sampleCollections, { format: 'csv' });

    expect(result.format).toBe('csv');
    expect(result.data).toContain('id');
  });

  it('should export as SQL', () => {
    const manager = createExportManager();
    const result = manager.export(sampleCollections, { format: 'sql' });

    expect(result.format).toBe('sql');
    expect(result.data).toContain('CREATE TABLE');
    expect(result.data).toContain('INSERT INTO');
  });

  it('should export as NDJSON', () => {
    const manager = createExportManager();
    const result = manager.export(sampleCollections, { format: 'ndjson' });

    expect(result.format).toBe('ndjson');
    const lines = result.data.split('\n');
    expect(lines).toHaveLength(4);
  });

  it('should filter collections by name', () => {
    const manager = createExportManager();
    const result = manager.export(sampleCollections, {
      format: 'json',
      collections: ['users'],
    });

    expect(result.collectionCount).toBe(1);
    expect(result.documentCount).toBe(2);
  });

  it('should import JSON data', () => {
    const manager = createExportManager();
    const exported = manager.export(sampleCollections, { format: 'json' });
    const result = manager.import(exported.data, { format: 'json' });

    expect(result.imported).toBe(4);
    expect(result.errors).toHaveLength(0);
  });

  it('should import NDJSON data', () => {
    const manager = createExportManager();
    const exported = manager.export(sampleCollections, { format: 'ndjson' });
    const result = manager.import(exported.data, { format: 'ndjson' });

    expect(result.imported).toBe(4);
  });

  it('should emit progress events', () => {
    const manager = createExportManager();
    const progressEvents: ExportProgress[] = [];

    manager.progress$.subscribe((p) => progressEvents.push(p));
    manager.export(sampleCollections, { format: 'json' });

    expect(progressEvents.length).toBeGreaterThan(0);
    const phases = progressEvents.map((p) => p.phase);
    expect(phases).toContain('preparing');
    expect(phases).toContain('exporting');
    expect(phases).toContain('finalizing');
  });

  it('should use config format as default', () => {
    const manager = createExportManager({ format: 'ndjson' });
    const result = manager.export(sampleCollections);

    expect(result.format).toBe('ndjson');
  });

  it('should handle import errors gracefully', () => {
    const manager = createExportManager();
    const result = manager.import('invalid data', { format: 'json' });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.imported).toBe(0);
  });
});
