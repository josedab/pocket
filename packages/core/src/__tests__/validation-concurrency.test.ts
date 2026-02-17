import { describe, it, expect } from 'vitest';
import {
  validateCollectionName,
  validateDocumentId,
  validateFieldPath,
  validatePagination,
  validateDocumentBody,
} from '../validation/input-validation.js';

describe('Validation Concurrency & Edge Cases', () => {
  describe('parallel validation isolation', () => {
    it('should handle 1000 concurrent collection name validations', async () => {
      const names = Array.from({ length: 1000 }, (_, i) => `coll_${i}`);
      const results = await Promise.all(names.map((n) => Promise.resolve(validateCollectionName(n))));
      expect(results.every((r) => r.valid)).toBe(true);
    });

    it('should isolate valid/invalid results in parallel', async () => {
      const inputs: unknown[] = ['valid', '', '__proto__', 'ok', null, '123bad', '_priv'];
      const results = await Promise.all(inputs.map((n) => Promise.resolve(validateCollectionName(n))));
      expect(results[0]!.valid).toBe(true);
      expect(results[1]!.valid).toBe(false);
      expect(results[2]!.valid).toBe(false);
      expect(results[3]!.valid).toBe(true);
      expect(results[4]!.valid).toBe(false);
      expect(results[5]!.valid).toBe(false);
      expect(results[6]!.valid).toBe(true);
    });
  });

  describe('prototype pollution defense in parallel', () => {
    it('should detect all dangerous paths concurrently', async () => {
      const paths = ['safe', '__proto__', 'user.name', 'constructor', 'a.prototype', 'ok.field'];
      const results = await Promise.all(paths.map((p) => Promise.resolve(validateFieldPath(p))));
      expect(results[0]!.valid).toBe(true);
      expect(results[1]!.valid).toBe(false);
      expect(results[2]!.valid).toBe(true);
      expect(results[3]!.valid).toBe(false);
      expect(results[4]!.valid).toBe(false);
      expect(results[5]!.valid).toBe(true);
    });

    it('should detect dangerous document keys concurrently', async () => {
      const docs = [{ safe: 1 }, { constructor: 'x' }, { prototype: {} }, { ok: true }];
      const results = await Promise.all(docs.map((d) => Promise.resolve(validateDocumentBody(d))));
      expect(results[0]!.valid).toBe(true);
      expect(results[1]!.valid).toBe(false);
      expect(results[2]!.valid).toBe(false);
      expect(results[3]!.valid).toBe(true);
    });
  });

  describe('boundary edge cases', () => {
    it('should handle exact-limit pagination', async () => {
      const cases: [unknown, unknown][] = [[0, 0], [10_000, 0], [1, 0], [10_000, 999999]];
      const results = await Promise.all(cases.map(([l, s]) => Promise.resolve(validatePagination(l, s))));
      expect(results.every((r) => r.valid)).toBe(true);
    });

    it('should reject just-over-limit values', async () => {
      expect(validatePagination(10_001).valid).toBe(false);
      expect(validatePagination(-1).valid).toBe(false);
      expect(validatePagination(10, -1).valid).toBe(false);
    });

    it('should handle max-length document IDs', () => {
      expect(validateDocumentId('a'.repeat(256)).valid).toBe(true);
      expect(validateDocumentId('a'.repeat(257)).valid).toBe(false);
    });

    it('should handle max-length collection names', () => {
      expect(validateCollectionName('a'.repeat(64)).valid).toBe(true);
      expect(validateCollectionName('a'.repeat(65)).valid).toBe(false);
    });

    it('should handle circular reference detection', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj['self'] = obj;
      expect(validateDocumentBody(obj).valid).toBe(false);
    });
  });
});
