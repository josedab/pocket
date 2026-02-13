import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImportExportManager, createImportExportManager } from '../import-export-manager.js';

describe('ImportExportManager', () => {
  let manager: ImportExportManager;

  beforeEach(() => {
    manager = createImportExportManager({ batchSize: 100 });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('createImportExportManager', () => {
    it('should return an ImportExportManager instance', () => {
      const m = createImportExportManager();
      expect(m).toBeInstanceOf(ImportExportManager);
      m.destroy();
    });

    it('should accept optional config', () => {
      const m = createImportExportManager({ batchSize: 500, maxImportSize: 50_000 });
      expect(m).toBeInstanceOf(ImportExportManager);
      m.destroy();
    });
  });

  describe('importData', () => {
    describe('JSON format', () => {
      it('should import a JSON array', async () => {
        const result = await manager.importData({
          format: 'json',
          data: '[{"name":"Alice","age":30},{"name":"Bob","age":25}]',
          collection: 'users',
        });

        expect(result.importedCount).toBe(2);
        expect(result.totalCount).toBe(2);
        expect(result.skippedCount).toBe(0);
        expect(result.errors).toEqual([]);
        expect(result.documents).toHaveLength(2);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      });

      it('should import a single JSON object as array of one', async () => {
        const result = await manager.importData({
          format: 'json',
          data: '{"name":"Alice"}',
          collection: 'users',
        });

        expect(result.importedCount).toBe(1);
        expect(result.documents[0]).toEqual({ name: 'Alice' });
      });
    });

    describe('CSV format', () => {
      it('should import CSV data', async () => {
        const csv = 'name,age\nAlice,30\nBob,25';
        const result = await manager.importData({
          format: 'csv',
          data: csv,
          collection: 'users',
        });

        expect(result.importedCount).toBe(2);
        expect(result.documents[0]).toEqual({ name: 'Alice', age: 30 });
        expect(result.documents[1]).toEqual({ name: 'Bob', age: 25 });
      });

      it('should handle CSV with boolean values', async () => {
        const csv = 'name,active\nAlice,true\nBob,false';
        const result = await manager.importData({
          format: 'csv',
          data: csv,
          collection: 'users',
        });

        expect(result.documents[0]).toEqual({ name: 'Alice', active: true });
        expect(result.documents[1]).toEqual({ name: 'Bob', active: false });
      });
    });

    describe('NDJSON format', () => {
      it('should import NDJSON data', async () => {
        const ndjson = '{"name":"Alice","age":30}\n{"name":"Bob","age":25}';
        const result = await manager.importData({
          format: 'ndjson',
          data: ndjson,
          collection: 'users',
        });

        expect(result.importedCount).toBe(2);
        expect(result.documents[0]).toEqual({ name: 'Alice', age: 30 });
      });

      it('should skip blank lines in NDJSON', async () => {
        const ndjson = '{"name":"Alice"}\n\n{"name":"Bob"}\n';
        const result = await manager.importData({
          format: 'ndjson',
          data: ndjson,
          collection: 'users',
        });

        expect(result.importedCount).toBe(2);
      });
    });

    describe('field mappings', () => {
      it('should apply field mappings to rename fields', async () => {
        const result = await manager.importData({
          format: 'json',
          data: '[{"first_name":"Alice","years":30}]',
          collection: 'users',
          fieldMappings: [
            { source: 'first_name', target: 'name' },
            { source: 'years', target: 'age' },
          ],
        });

        expect(result.documents[0]).toEqual({ name: 'Alice', age: 30 });
      });

      it('should apply transform functions in field mappings', async () => {
        const result = await manager.importData({
          format: 'json',
          data: '[{"name":"alice"}]',
          collection: 'users',
          fieldMappings: [
            {
              source: 'name',
              target: 'name',
              transform: (v) => (v as string).toUpperCase(),
            },
          ],
        });

        expect(result.documents[0]).toEqual({ name: 'ALICE' });
      });
    });

    describe('schema validation', () => {
      it('should reject documents that fail validation', async () => {
        const result = await manager.importData({
          format: 'json',
          data: '[{"name":"Alice","age":30},{"name":123,"age":"not-a-number"}]',
          collection: 'users',
          schema: [
            { name: 'name', type: 'string', required: true },
            { name: 'age', type: 'number', required: true },
          ],
        });

        expect(result.importedCount).toBe(1);
        expect(result.skippedCount).toBe(1);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should report missing required fields', async () => {
        const result = await manager.importData({
          format: 'json',
          data: '[{"age":30}]',
          collection: 'users',
          schema: [{ name: 'name', type: 'string', required: true }],
        });

        expect(result.importedCount).toBe(0);
        expect(result.errors[0]!.message).toContain('name');
        expect(result.errors[0]!.message).toContain('missing');
      });
    });
  });

  describe('exportData', () => {
    const docs = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];

    describe('JSON format', () => {
      it('should export to JSON', () => {
        const result = manager.exportData({
          format: 'json',
          documents: docs,
        });

        const parsed = JSON.parse(result);
        expect(parsed).toEqual(docs);
      });

      it('should export with field filtering', () => {
        const result = manager.exportData({
          format: 'json',
          documents: docs,
          fields: ['name'],
        });

        const parsed = JSON.parse(result);
        expect(parsed).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
      });
    });

    describe('CSV format', () => {
      it('should export to CSV', () => {
        const result = manager.exportData({
          format: 'csv',
          documents: docs,
        });

        const lines = result.split('\n');
        expect(lines[0]).toContain('name');
        expect(lines[0]).toContain('age');
        expect(lines).toHaveLength(3); // header + 2 data rows
      });
    });

    describe('NDJSON format', () => {
      it('should export to NDJSON', () => {
        const result = manager.exportData({
          format: 'ndjson',
          documents: docs,
        });

        const lines = result.split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]!)).toEqual(docs[0]);
        expect(JSON.parse(lines[1]!)).toEqual(docs[1]);
      });
    });
  });

  describe('getProgress', () => {
    it('should track import progress via observable', async () => {
      const progressValues: unknown[] = [];
      const sub = manager.getProgress().subscribe((p) => {
        if (p !== null) progressValues.push(p);
      });

      await manager.importData({
        format: 'json',
        data: '[{"name":"Alice"},{"name":"Bob"}]',
        collection: 'users',
      });

      sub.unsubscribe();
      expect(progressValues.length).toBeGreaterThan(0);
      const last = progressValues[progressValues.length - 1] as {
        percent: number;
        operation: string;
      };
      expect(last.percent).toBe(100);
      expect(last.operation).toBe('import');
    });
  });

  describe('destroy', () => {
    it('should complete streams on destroy', () => {
      let completed = false;
      manager.getProgress().subscribe({
        complete: () => {
          completed = true;
        },
      });
      manager.destroy();
      expect(completed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty JSON array', async () => {
      const result = await manager.importData({
        format: 'json',
        data: '[]',
        collection: 'users',
      });

      expect(result.importedCount).toBe(0);
      expect(result.totalCount).toBe(0);
      expect(result.documents).toEqual([]);
    });

    it('should handle empty CSV (header only)', async () => {
      const result = await manager.importData({
        format: 'csv',
        data: 'name,age',
        collection: 'users',
      });

      expect(result.importedCount).toBe(0);
    });

    it('should throw for oversized import', async () => {
      const m = createImportExportManager({ maxImportSize: 2 });
      const data = JSON.stringify([{ a: 1 }, { b: 2 }, { c: 3 }]);

      await expect(m.importData({ format: 'json', data, collection: 'test' })).rejects.toThrow(
        'exceeds maximum'
      );

      m.destroy();
    });

    it('should export empty documents array', () => {
      const result = manager.exportData({
        format: 'json',
        documents: [],
      });
      expect(JSON.parse(result)).toEqual([]);
    });

    it('should export empty documents as empty CSV', () => {
      const result = manager.exportData({
        format: 'csv',
        documents: [],
      });
      expect(result).toBe('');
    });
  });
});
