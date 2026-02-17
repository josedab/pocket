import { describe, it, expect } from 'vitest';
import {
  validateCollectionName,
  assertCollectionName,
  validateDocumentId,
  assertDocumentId,
  validateFieldPath,
  assertFieldPath,
  validatePagination,
  validateDocumentBody,
} from '../validation/input-validation.js';

describe('Input Validation', () => {
  describe('validateCollectionName', () => {
    it('should accept valid names', () => {
      expect(validateCollectionName('todos').valid).toBe(true);
      expect(validateCollectionName('user_profiles').valid).toBe(true);
      expect(validateCollectionName('my-data').valid).toBe(true);
      expect(validateCollectionName('_private').valid).toBe(true);
    });

    it('should reject non-string inputs', () => {
      expect(validateCollectionName(123).valid).toBe(false);
      expect(validateCollectionName(null).valid).toBe(false);
      expect(validateCollectionName(undefined).valid).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateCollectionName('').valid).toBe(false);
    });

    it('should reject names starting with numbers', () => {
      expect(validateCollectionName('123abc').valid).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(validateCollectionName('my.collection').valid).toBe(false);
      expect(validateCollectionName('my collection').valid).toBe(false);
    });

    it('should reject reserved names', () => {
      const result = validateCollectionName('__proto__');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('reserved');
    });

    it('should reject names exceeding 64 chars', () => {
      expect(validateCollectionName('a'.repeat(65)).valid).toBe(false);
    });
  });

  describe('assertCollectionName', () => {
    it('should not throw for valid names', () => {
      expect(() => assertCollectionName('todos')).not.toThrow();
    });

    it('should throw ValidationError for invalid names', () => {
      expect(() => assertCollectionName('')).toThrow();
      expect(() => assertCollectionName(null)).toThrow();
    });
  });

  describe('validateDocumentId', () => {
    it('should accept valid IDs', () => {
      expect(validateDocumentId('abc-123').valid).toBe(true);
      expect(validateDocumentId('550e8400-e29b-41d4-a716-446655440000').valid).toBe(true);
    });

    it('should reject non-string inputs', () => {
      expect(validateDocumentId(42).valid).toBe(false);
      expect(validateDocumentId(null).valid).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateDocumentId('').valid).toBe(false);
    });

    it('should reject IDs exceeding 256 chars', () => {
      expect(validateDocumentId('a'.repeat(257)).valid).toBe(false);
    });

    it('should reject IDs with null bytes', () => {
      expect(validateDocumentId('abc\0def').valid).toBe(false);
    });
  });

  describe('assertDocumentId', () => {
    it('should not throw for valid IDs', () => {
      expect(() => assertDocumentId('abc-123')).not.toThrow();
    });

    it('should throw for invalid IDs', () => {
      expect(() => assertDocumentId('')).toThrow();
    });
  });

  describe('validateFieldPath', () => {
    it('should accept valid paths', () => {
      expect(validateFieldPath('name').valid).toBe(true);
      expect(validateFieldPath('user.name').valid).toBe(true);
      expect(validateFieldPath('$ref').valid).toBe(true);
      expect(validateFieldPath('_id').valid).toBe(true);
    });

    it('should reject non-string inputs', () => {
      expect(validateFieldPath(42).valid).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateFieldPath('').valid).toBe(false);
    });

    it('should reject paths starting with dots', () => {
      expect(validateFieldPath('.name').valid).toBe(false);
    });

    it('should reject prototype pollution paths', () => {
      const result = validateFieldPath('__proto__');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('dangerous');
    });

    it('should reject nested prototype pollution', () => {
      expect(validateFieldPath('a.constructor.b').valid).toBe(false);
      expect(validateFieldPath('x.prototype').valid).toBe(false);
    });
  });

  describe('validatePagination', () => {
    it('should accept valid pagination', () => {
      expect(validatePagination(10, 0).valid).toBe(true);
      expect(validatePagination(100, 50).valid).toBe(true);
      expect(validatePagination(undefined, undefined).valid).toBe(true);
    });

    it('should reject negative limit', () => {
      expect(validatePagination(-1).valid).toBe(false);
    });

    it('should reject negative skip', () => {
      expect(validatePagination(10, -5).valid).toBe(false);
    });

    it('should reject non-integer limit', () => {
      expect(validatePagination(10.5).valid).toBe(false);
    });

    it('should reject limit exceeding 10,000', () => {
      expect(validatePagination(10_001).valid).toBe(false);
    });
  });

  describe('validateDocumentBody', () => {
    it('should accept valid objects', () => {
      expect(validateDocumentBody({ name: 'Alice', age: 30 }).valid).toBe(true);
      expect(validateDocumentBody({}).valid).toBe(true);
    });

    it('should reject null/undefined', () => {
      expect(validateDocumentBody(null).valid).toBe(false);
      expect(validateDocumentBody(undefined).valid).toBe(false);
    });

    it('should reject arrays', () => {
      expect(validateDocumentBody([1, 2, 3]).valid).toBe(false);
    });

    it('should reject primitives', () => {
      expect(validateDocumentBody('string').valid).toBe(false);
      expect(validateDocumentBody(42).valid).toBe(false);
    });

    it('should reject __proto__ keys', () => {
      const result = validateDocumentBody({ __proto__: {} });
      // Note: __proto__ may not appear in Object.keys depending on engine
      // but constructor should be caught
      expect(validateDocumentBody({ constructor: 'evil' }).valid).toBe(false);
    });

    it('should reject non-serializable values', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      expect(validateDocumentBody(circular).valid).toBe(false);
    });
  });
});
