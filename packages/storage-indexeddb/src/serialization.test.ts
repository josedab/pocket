import { describe, it, expect } from 'vitest';
import { serializeDocument, deserializeDocument } from './serialization.js';

interface TestDocument {
  _id: string;
  _rev: string;
  name: string;
  createdAt?: Date;
  data?: Uint8Array;
  nested?: { value: number };
}

describe('Serialization', () => {
  describe('serializeDocument', () => {
    it('should serialize a simple document', () => {
      const doc: TestDocument = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
      };

      const serialized = serializeDocument(doc);

      expect(serialized._id).toBe('1');
      expect(serialized._rev).toBe('1-abc');
      expect(serialized.name).toBe('Test');
    });

    it('should create a deep clone of the document', () => {
      const doc: TestDocument = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
        nested: { value: 42 },
      };

      const serialized = serializeDocument(doc);

      // Modifying serialized should not affect original
      serialized.nested!.value = 100;
      expect(doc.nested!.value).toBe(42);
    });

    it('should preserve Date objects', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const doc: TestDocument = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
        createdAt: date,
      };

      const serialized = serializeDocument(doc);

      expect(serialized.createdAt).toBeInstanceOf(Date);
      expect(serialized.createdAt?.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should handle null and undefined values', () => {
      const doc = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
        nullValue: null,
        undefinedValue: undefined,
      };

      const serialized = serializeDocument(doc as unknown as TestDocument);

      expect(serialized).toHaveProperty('nullValue', null);
    });

    it('should serialize arrays', () => {
      const doc = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
        tags: ['a', 'b', 'c'],
      };

      const serialized = serializeDocument(doc as unknown as TestDocument);

      expect(serialized).toHaveProperty('tags');
      expect((serialized as unknown as { tags: string[] }).tags).toEqual(['a', 'b', 'c']);
    });
  });

  describe('deserializeDocument', () => {
    it('should deserialize a simple document', () => {
      const raw = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
      };

      const doc = deserializeDocument<TestDocument>(raw);

      expect(doc._id).toBe('1');
      expect(doc._rev).toBe('1-abc');
      expect(doc.name).toBe('Test');
    });

    it('should create a deep clone of the stored document', () => {
      const raw = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
        nested: { value: 42 },
      };

      const doc = deserializeDocument<TestDocument>(raw);

      // Modifying doc should not affect raw
      doc.nested!.value = 100;
      expect(raw.nested.value).toBe(42);
    });

    it('should preserve Date objects from IndexedDB', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const raw = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
        createdAt: date,
      };

      const doc = deserializeDocument<TestDocument>(raw);

      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.createdAt?.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should handle arrays', () => {
      const raw = {
        _id: '1',
        _rev: '1-abc',
        name: 'Test',
        tags: ['a', 'b', 'c'],
      };

      const doc = deserializeDocument(raw as unknown as TestDocument);

      expect((doc as unknown as { tags: string[] }).tags).toEqual(['a', 'b', 'c']);
    });
  });
});
