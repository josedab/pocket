import { describe, it, expect } from 'vitest';
import {
  validateCollectionName,
  validateDocumentId,
  validateDocumentBody,
  validateFieldPath,
  validatePagination,
  assertCollectionName,
  assertDocumentId,
  assertFieldPath,
} from '../validation/input-validation.js';

describe('Database Operation Error Paths', () => {
  describe('collection name errors', () => {
    it('should reject numeric input', () => {
      const r = validateCollectionName(42);
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('string');
    });

    it('should reject boolean input', () => {
      expect(validateCollectionName(true).valid).toBe(false);
    });

    it('should reject object input', () => {
      expect(validateCollectionName({}).valid).toBe(false);
    });

    it('should reject empty string', () => {
      const r = validateCollectionName('');
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('empty');
    });

    it('should reject names with spaces', () => {
      expect(validateCollectionName('my collection').valid).toBe(false);
    });

    it('should reject names with dots', () => {
      expect(validateCollectionName('my.collection').valid).toBe(false);
    });

    it('should reject _system reserved name', () => {
      const r = validateCollectionName('_system');
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('reserved');
    });

    it('should reject _metadata reserved name', () => {
      expect(validateCollectionName('_metadata').valid).toBe(false);
    });

    it('should reject _migrations reserved name', () => {
      expect(validateCollectionName('_migrations').valid).toBe(false);
    });

    it('should reject _sync reserved name', () => {
      expect(validateCollectionName('_sync').valid).toBe(false);
    });

    it('should accept valid edge cases', () => {
      expect(validateCollectionName('a').valid).toBe(true);
      expect(validateCollectionName('A').valid).toBe(true);
      expect(validateCollectionName('_').valid).toBe(true);
      expect(validateCollectionName('a_b-c').valid).toBe(true);
    });
  });

  describe('document ID errors', () => {
    it('should reject numeric input', () => {
      expect(validateDocumentId(123).valid).toBe(false);
    });

    it('should reject array input', () => {
      expect(validateDocumentId([]).valid).toBe(false);
    });

    it('should reject null bytes in ID', () => {
      const r = validateDocumentId('abc\x00def');
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('null');
    });

    it('should accept single character ID', () => {
      expect(validateDocumentId('x').valid).toBe(true);
    });

    it('should accept UUID-style ID', () => {
      expect(validateDocumentId('550e8400-e29b-41d4-a716-446655440000').valid).toBe(true);
    });

    it('should accept exactly 256 character ID', () => {
      expect(validateDocumentId('x'.repeat(256)).valid).toBe(true);
    });

    it('should reject 257 character ID', () => {
      expect(validateDocumentId('x'.repeat(257)).valid).toBe(false);
    });
  });

  describe('document body errors', () => {
    it('should reject string as body', () => {
      expect(validateDocumentBody('not an object').valid).toBe(false);
    });

    it('should reject number as body', () => {
      expect(validateDocumentBody(42).valid).toBe(false);
    });

    it('should reject boolean as body', () => {
      expect(validateDocumentBody(true).valid).toBe(false);
    });

    it('should reject array as body', () => {
      expect(validateDocumentBody([{ id: 1 }]).valid).toBe(false);
    });

    it('should reject constructor key', () => {
      const r = validateDocumentBody({ constructor: 'evil' });
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('prototype pollution');
    });

    it('should reject prototype key', () => {
      expect(validateDocumentBody({ prototype: {} }).valid).toBe(false);
    });

    it('should accept deeply nested valid object', () => {
      expect(validateDocumentBody({
        a: { b: { c: { d: { e: 'deep' } } } },
      }).valid).toBe(true);
    });

    it('should detect circular references', () => {
      const obj: Record<string, unknown> = {};
      obj['loop'] = obj;
      const r = validateDocumentBody(obj);
      expect(r.valid).toBe(false);
      expect(r.errors[0]).toContain('non-serializable');
    });

    it('should accept empty object', () => {
      expect(validateDocumentBody({}).valid).toBe(true);
    });
  });

  describe('field path errors', () => {
    it('should reject paths starting with number', () => {
      expect(validateFieldPath('0field').valid).toBe(false);
    });

    it('should reject paths with spaces', () => {
      expect(validateFieldPath('field name').valid).toBe(false);
    });

    it('should reject trailing dot', () => {
      expect(validateFieldPath('field.').valid).toBe(false);
    });

    it('should reject double dots', () => {
      expect(validateFieldPath('a..b').valid).toBe(false);
    });

    it('should reject __proto__ at any depth', () => {
      expect(validateFieldPath('a.b.__proto__').valid).toBe(false);
    });

    it('should reject constructor at any depth', () => {
      expect(validateFieldPath('a.constructor.b').valid).toBe(false);
    });

    it('should accept $ prefixed paths', () => {
      expect(validateFieldPath('$ref').valid).toBe(true);
      expect(validateFieldPath('_$field').valid).toBe(true);
    });
  });

  describe('pagination errors', () => {
    it('should reject string limit', () => {
      expect(validatePagination('10').valid).toBe(false);
    });

    it('should reject float limit', () => {
      expect(validatePagination(10.5).valid).toBe(false);
    });

    it('should reject NaN limit', () => {
      expect(validatePagination(NaN).valid).toBe(false);
    });

    it('should reject Infinity limit', () => {
      expect(validatePagination(Infinity).valid).toBe(false);
    });

    it('should reject string skip', () => {
      expect(validatePagination(10, '5').valid).toBe(false);
    });

    it('should accept zero limit', () => {
      expect(validatePagination(0).valid).toBe(true);
    });

    it('should accept exactly 10000 limit', () => {
      expect(validatePagination(10_000).valid).toBe(true);
    });

    it('should reject 10001 limit', () => {
      expect(validatePagination(10_001).valid).toBe(false);
    });
  });

  describe('assertion functions', () => {
    it('assertCollectionName should throw for invalid', () => {
      expect(() => assertCollectionName(42)).toThrow();
      expect(() => assertCollectionName('')).toThrow();
      expect(() => assertCollectionName('__proto__')).toThrow();
    });

    it('assertCollectionName should not throw for valid', () => {
      expect(() => assertCollectionName('todos')).not.toThrow();
    });

    it('assertDocumentId should throw for invalid', () => {
      expect(() => assertDocumentId(null)).toThrow();
      expect(() => assertDocumentId('')).toThrow();
    });

    it('assertDocumentId should not throw for valid', () => {
      expect(() => assertDocumentId('abc-123')).not.toThrow();
    });

    it('assertFieldPath should throw for prototype pollution', () => {
      expect(() => assertFieldPath('__proto__')).toThrow();
      expect(() => assertFieldPath('a.constructor')).toThrow();
    });

    it('assertFieldPath should not throw for valid', () => {
      expect(() => assertFieldPath('user.name')).not.toThrow();
    });
  });
});
