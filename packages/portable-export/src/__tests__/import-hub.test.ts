import { describe, it, expect } from 'vitest';
import { createImportExportHub } from '../import-hub.js';
import type { ImportFormat } from '../import-hub.js';

describe('ImportExportHub', () => {
  const hub = createImportExportHub();

  // --- Import CSV ---
  it('should import CSV data', async () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const result = await hub.importData(csv, { format: 'csv', collection: 'users' });
    expect(result.collection).toBe('users');
    expect(result.documentsImported).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- Import JSON array ---
  it('should import JSON array', async () => {
    const json = JSON.stringify([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
    const result = await hub.importData(json, { format: 'json', collection: 'users' });
    expect(result.documentsImported).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  // --- Import JSONL ---
  it('should import JSONL data', async () => {
    const jsonl = '{"id":"1","name":"Alice"}\n{"id":"2","name":"Bob"}';
    const result = await hub.importData(jsonl, { format: 'jsonl', collection: 'users' });
    expect(result.documentsImported).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  // --- Import Firebase format ---
  it('should import Firebase format', async () => {
    const firebase = JSON.stringify({
      users: {
        user1: { name: 'Alice', age: 30 },
        user2: { name: 'Bob', age: 25 },
      },
    });
    const result = await hub.importData(firebase, { format: 'firebase', collection: 'users' });
    expect(result.documentsImported).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  // --- Import PouchDB format ---
  it('should import PouchDB format', async () => {
    const pouchdb = JSON.stringify({
      rows: [
        { doc: { _id: 'user1', name: 'Alice' } },
        { doc: { _id: 'user2', name: 'Bob' } },
      ],
    });
    const result = await hub.importData(pouchdb, { format: 'pouchdb', collection: 'users' });
    expect(result.documentsImported).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  // --- Export to CSV ---
  it('should export to CSV', () => {
    const docs = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const csv = hub.exportData(docs, { format: 'csv', collection: 'users' });
    expect(csv).toContain('name,age');
    expect(csv).toContain('Alice,30');
    expect(csv).toContain('Bob,25');
  });

  // --- Export to JSON ---
  it('should export to JSON', () => {
    const docs = [{ name: 'Alice' }];
    const json = hub.exportData(docs, { format: 'json', collection: 'users', pretty: true });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([{ name: 'Alice' }]);
    expect(json).toContain('\n'); // pretty-printed
  });

  // --- Export to SQL ---
  it('should export to SQL', () => {
    const docs = [
      { id: 1, name: 'Alice' },
      { id: 2, name: "Bob's" },
    ];
    const sql = hub.exportData(docs, { format: 'sql', collection: 'users' });
    expect(sql).toContain("INSERT INTO users (id, name) VALUES (1, 'Alice');");
    expect(sql).toContain("INSERT INTO users (id, name) VALUES (2, 'Bob''s');");
  });

  // --- Format auto-detection ---
  describe('detectFormat', () => {
    it('should detect CSV', () => {
      expect(hub.detectFormat('name,age\nAlice,30')).toBe('csv');
    });

    it('should detect JSON array', () => {
      expect(hub.detectFormat('[{"a":1}]')).toBe('json');
    });

    it('should detect JSONL', () => {
      expect(hub.detectFormat('{"a":1}\n{"b":2}')).toBe('jsonl');
    });

    it('should detect Firebase format', () => {
      const firebase = JSON.stringify({
        users: { u1: { name: 'Alice' }, u2: { name: 'Bob' } },
      });
      expect(hub.detectFormat(firebase)).toBe('firebase');
    });

    it('should detect PouchDB format', () => {
      const pouchdb = JSON.stringify({ rows: [{ doc: { _id: '1' } }] });
      expect(hub.detectFormat(pouchdb)).toBe('pouchdb');
    });

    it('should return null for unknown format', () => {
      expect(hub.detectFormat('just some random text')).toBeNull();
    });
  });

  // --- Import with transform ---
  it('should apply transform function on import', async () => {
    const json = JSON.stringify([{ name: 'alice' }, { name: 'bob' }]);
    const result = await hub.importData(json, {
      format: 'json',
      collection: 'users',
      transform: (doc) => ({ ...doc, name: String(doc.name).toUpperCase() }),
    });
    expect(result.documentsImported).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  // --- Import with errors (skip mode) ---
  it('should skip errors when skipErrors is true', async () => {
    const jsonl = '{"valid":true}\nINVALID JSON\n{"also":"valid"}';
    const result = await hub.importData(jsonl, {
      format: 'jsonl',
      collection: 'data',
      skipErrors: true,
    });
    expect(result.documentsImported).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(2);
  });

  // --- Validate import ---
  describe('validateImport', () => {
    it('should validate valid CSV', () => {
      const result = hub.validateImport('name,age\nAlice,30', 'csv');
      expect(result.valid).toBe(true);
      expect(result.documentCount).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should report invalid JSON', () => {
      const result = hub.validateImport('not json', 'json');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --- getSupportedFormats ---
  it('should return supported formats', () => {
    const formats = hub.getSupportedFormats();
    expect(formats.import).toContain('csv');
    expect(formats.import).toContain('firebase');
    expect(formats.import).toContain('pouchdb');
    expect(formats.export).toContain('sql');
    expect(formats.export).toContain('json');
  });

  // --- Export CSV with commas in fields ---
  it('should quote CSV fields containing commas', () => {
    const docs = [{ name: 'Doe, Jane', age: 30 }];
    const csv = hub.exportData(docs, { format: 'csv', collection: 'users' });
    expect(csv).toContain('"Doe, Jane"');
  });

  // --- Export JSONL ---
  it('should export to JSONL', () => {
    const docs = [{ a: 1 }, { b: 2 }];
    const jsonl = hub.exportData(docs, { format: 'jsonl', collection: 'data' });
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ b: 2 });
  });
});
