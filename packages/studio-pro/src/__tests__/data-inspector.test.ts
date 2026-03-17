import { beforeEach, describe, expect, it } from 'vitest';
import type { DataInspector } from '../data-inspector.js';
import { createDataInspector } from '../data-inspector.js';

describe('DataInspector', () => {
  let inspector: DataInspector;

  const docs = [
    { _id: '1', name: 'Alice', email: 'alice@test.com', age: 30 },
    { _id: '2', name: 'Bob', email: 'bob@test.com', age: 25 },
    { _id: '3', name: 'Charlie', email: 'charlie@test.com', age: 35 },
    { _id: '4', name: 'Diana', email: 'diana@test.com', age: 28 },
    { _id: '5', name: 'Eve', email: 'eve@test.com', age: 32 },
    { _id: '6', name: 'Frank', email: 'frank@test.com', age: 45 },
    { _id: '7', name: 'Grace', email: 'grace@test.com', age: 22 },
  ];

  beforeEach(() => {
    inspector = createDataInspector();
  });

  // ── Pagination (inspect) ──────────────────────────────────────────

  describe('inspect', () => {
    it('should return the correct collection name', () => {
      const state = inspector.inspect('users', docs, 0, 10);
      expect(state.collection).toBe('users');
    });

    it('should return the first page of results', () => {
      const state = inspector.inspect('users', docs, 0, 3);
      expect(state.documents.length).toBe(3);
      expect((state.documents[0] as Record<string, unknown>)['_id']).toBe('1');
      expect((state.documents[2] as Record<string, unknown>)['_id']).toBe('3');
    });

    it('should return the second page', () => {
      const state = inspector.inspect('users', docs, 1, 3);
      expect(state.documents.length).toBe(3);
      expect((state.documents[0] as Record<string, unknown>)['_id']).toBe('4');
    });

    it('should handle a partial last page', () => {
      const state = inspector.inspect('users', docs, 2, 3);
      expect(state.documents.length).toBe(1); // 7 docs, page 2 of size 3 = 1 doc
    });

    it('should return empty array for out-of-range page', () => {
      const state = inspector.inspect('users', docs, 100, 3);
      expect(state.documents).toEqual([]);
    });

    it('should always return totalCount of full collection', () => {
      const state = inspector.inspect('users', docs, 0, 2);
      expect(state.totalCount).toBe(7);
    });

    it('should reflect page and pageSize in state', () => {
      const state = inspector.inspect('users', docs, 2, 5);
      expect(state.page).toBe(2);
      expect(state.pageSize).toBe(5);
    });

    it('should default sortField to null and sortDirection to asc', () => {
      const state = inspector.inspect('users', docs, 0, 10);
      expect(state.sortField).toBeNull();
      expect(state.sortDirection).toBe('asc');
    });

    it('should handle empty documents', () => {
      const state = inspector.inspect('empty', [], 0, 10);
      expect(state.documents).toEqual([]);
      expect(state.totalCount).toBe(0);
    });

    it('should return all docs when pageSize >= total', () => {
      const state = inspector.inspect('users', docs, 0, 100);
      expect(state.documents.length).toBe(7);
    });

    it('should handle pageSize of 1', () => {
      const state = inspector.inspect('users', docs, 3, 1);
      expect(state.documents.length).toBe(1);
      expect((state.documents[0] as Record<string, unknown>)['_id']).toBe('4');
    });
  });

  // ── Search ────────────────────────────────────────────────────────

  describe('search', () => {
    it('should find documents matching name', () => {
      const results = inspector.search('users', docs, 'Alice');
      expect(results.length).toBe(1);
      expect((results[0] as Record<string, unknown>)['name']).toBe('Alice');
    });

    it('should be case-insensitive', () => {
      const results = inspector.search('users', docs, 'CHARLIE');
      expect(results.length).toBe(1);
    });

    it('should match partial strings', () => {
      const results = inspector.search('users', docs, 'ali');
      expect(results.length).toBe(1);
    });

    it('should search across all string fields including email', () => {
      const results = inspector.search('users', docs, '@test.com');
      expect(results.length).toBe(7);
    });

    it('should return empty for no match', () => {
      const results = inspector.search('users', docs, 'zzzzz');
      expect(results).toEqual([]);
    });

    it('should not match non-string fields', () => {
      const results = inspector.search('users', docs, '30');
      // age is a number, not a string → no match
      expect(results).toEqual([]);
    });

    it('should handle empty query (matches all with string fields)', () => {
      const results = inspector.search('users', docs, '');
      // empty string is included in every string via .includes('')
      expect(results.length).toBe(7);
    });

    it('should handle empty documents', () => {
      const results = inspector.search('users', [], 'Alice');
      expect(results).toEqual([]);
    });

    it('should match email-specific search', () => {
      const results = inspector.search('users', docs, 'frank@');
      expect(results.length).toBe(1);
      expect((results[0] as Record<string, unknown>)['name']).toBe('Frank');
    });
  });

  // ── Get Document By ID ────────────────────────────────────────────

  describe('getDocumentById', () => {
    it('should return the correct document', () => {
      const doc = inspector.getDocumentById('users', docs, '3');
      expect(doc).not.toBeNull();
      expect(doc!['name']).toBe('Charlie');
    });

    it('should return null for non-existent ID', () => {
      const doc = inspector.getDocumentById('users', docs, 'doesnotexist');
      expect(doc).toBeNull();
    });

    it('should return null for empty documents', () => {
      const doc = inspector.getDocumentById('users', [], '1');
      expect(doc).toBeNull();
    });

    it('should match _id exactly (not partial)', () => {
      const doc = inspector.getDocumentById('users', docs, '');
      expect(doc).toBeNull();
    });

    it('should return first document', () => {
      const doc = inspector.getDocumentById('users', docs, '1');
      expect(doc!['name']).toBe('Alice');
    });

    it('should return last document', () => {
      const doc = inspector.getDocumentById('users', docs, '7');
      expect(doc!['name']).toBe('Grace');
    });
  });

  // ── Collection Stats ──────────────────────────────────────────────

  describe('getCollectionStats', () => {
    it('should return correct document count', () => {
      const stats = inspector.getCollectionStats('users', docs);
      expect(stats.count).toBe(7);
    });

    it('should return positive avgDocSize', () => {
      const stats = inspector.getCollectionStats('users', docs);
      expect(stats.avgDocSize).toBeGreaterThan(0);
    });

    it('should list all field names', () => {
      const stats = inspector.getCollectionStats('users', docs);
      expect(stats.fields).toContain('_id');
      expect(stats.fields).toContain('name');
      expect(stats.fields).toContain('email');
      expect(stats.fields).toContain('age');
    });

    it('should handle empty collection', () => {
      const stats = inspector.getCollectionStats('empty', []);
      expect(stats.count).toBe(0);
      expect(stats.avgDocSize).toBe(0);
      expect(stats.fields).toEqual([]);
    });

    it('should collect fields from all documents even if sparse', () => {
      const sparse = [
        { _id: '1', name: 'A' },
        { _id: '2', email: 'b@test.com' },
      ];
      const stats = inspector.getCollectionStats('sparse', sparse);
      expect(stats.fields).toContain('_id');
      expect(stats.fields).toContain('name');
      expect(stats.fields).toContain('email');
    });

    it('should compute avgDocSize as rounded integer', () => {
      const stats = inspector.getCollectionStats('users', docs);
      expect(Number.isInteger(stats.avgDocSize)).toBe(true);
    });
  });

  // ── Export JSON ───────────────────────────────────────────────────

  describe('exportData (json)', () => {
    it('should produce valid JSON', () => {
      const json = inspector.exportData('users', docs, 'json');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include all documents', () => {
      const json = inspector.exportData('users', docs, 'json');
      const parsed = JSON.parse(json);
      expect(parsed.length).toBe(7);
    });

    it('should preserve document fields', () => {
      const json = inspector.exportData('users', docs.slice(0, 1), 'json');
      const parsed = JSON.parse(json);
      expect(parsed[0].name).toBe('Alice');
      expect(parsed[0].email).toBe('alice@test.com');
    });

    it('should be pretty-printed with 2 spaces', () => {
      const json = inspector.exportData('users', docs.slice(0, 1), 'json');
      expect(json).toContain('\n');
      expect(json).toContain('  ');
    });

    it('should export empty array for no docs', () => {
      const json = inspector.exportData('users', [], 'json');
      expect(json).toBe('[]');
    });
  });

  // ── Export CSV ────────────────────────────────────────────────────

  describe('exportData (csv)', () => {
    it('should include header row', () => {
      const csv = inspector.exportData('users', docs.slice(0, 1), 'csv');
      const lines = csv.split('\n');
      expect(lines[0]).toContain('name');
      expect(lines[0]).toContain('email');
    });

    it('should include data rows', () => {
      const csv = inspector.exportData('users', docs.slice(0, 2), 'csv');
      const lines = csv.split('\n');
      expect(lines.length).toBe(3); // header + 2 rows
    });

    it('should return empty string for empty docs', () => {
      const csv = inspector.exportData('users', [], 'csv');
      expect(csv).toBe('');
    });

    it('should quote values containing commas', () => {
      const commaDoc = [{ _id: '1', desc: 'hello, world' }];
      const csv = inspector.exportData('test', commaDoc, 'csv');
      expect(csv).toContain('"hello, world"');
    });

    it('should escape double quotes in values', () => {
      const quoteDoc = [{ _id: '1', desc: 'say "hello"' }];
      const csv = inspector.exportData('test', quoteDoc, 'csv');
      expect(csv).toContain('"say ""hello"""');
    });

    it('should handle null/undefined values as empty', () => {
      const doc = [{ _id: '1', a: null, b: undefined }];
      const csv = inspector.exportData('test', doc, 'csv');
      const lines = csv.split('\n');
      const dataLine = lines[1]!;
      // null and undefined should become empty string
      expect(dataLine).toMatch(/,,|,$/);
    });

    it('should collect headers from all documents', () => {
      const sparse = [
        { _id: '1', name: 'A' },
        { _id: '2', email: 'b@test.com' },
      ];
      const csv = inspector.exportData('test', sparse, 'csv');
      const header = csv.split('\n')[0]!;
      expect(header).toContain('name');
      expect(header).toContain('email');
      expect(header).toContain('_id');
    });

    it('should handle single document', () => {
      const csv = inspector.exportData('test', [{ _id: '1', x: 'hello' }], 'csv');
      const lines = csv.split('\n');
      expect(lines.length).toBe(2);
    });
  });

  // ── Default Config ────────────────────────────────────────────────

  describe('configuration', () => {
    it('should accept config argument', () => {
      const i = createDataInspector({ maxHistoryEntries: 10 });
      const state = i.inspect('t', docs, 0, 5);
      expect(state.totalCount).toBe(7);
    });

    it('should work with default config', () => {
      const i = createDataInspector();
      const state = i.inspect('t', docs, 0, 5);
      expect(state.totalCount).toBe(7);
    });
  });
});
