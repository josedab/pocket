import { describe, it, expect } from 'vitest';
import { validateQuery, quickValidateQuery } from '../query-validator.js';

const SCHEMAS = [
  {
    name: 'todos',
    fields: [
      { name: 'title', type: 'string' as const },
      { name: 'completed', type: 'boolean' as const },
      { name: 'priority', type: 'number' as const },
      { name: 'tags', type: 'array' as const },
    ],
  },
  {
    name: 'users',
    fields: [
      { name: 'name', type: 'string' as const },
      { name: 'age', type: 'number' as const },
    ],
  },
];

describe('QueryValidator', () => {
  describe('collection validation', () => {
    it('should accept valid collection', () => {
      const r = validateQuery({ collection: 'todos' }, SCHEMAS);
      expect(r.valid).toBe(true);
    });

    it('should reject unknown collection', () => {
      const r = validateQuery({ collection: 'nonexistent' }, SCHEMAS);
      expect(r.valid).toBe(false);
      expect(r.issues[0]!.message).toContain('Unknown collection');
    });

    it('should suggest available collections', () => {
      const r = validateQuery({ collection: 'bad' }, SCHEMAS);
      expect(r.issues[0]!.suggestion).toContain('todos');
    });
  });

  describe('field validation', () => {
    it('should accept known filter fields', () => {
      const r = validateQuery({ collection: 'todos', filter: { completed: false } }, SCHEMAS);
      expect(r.valid).toBe(true);
      expect(r.fieldsCovered).toContain('completed');
    });

    it('should warn on unknown filter fields', () => {
      const r = validateQuery({ collection: 'todos', filter: { nonexistent: true } }, SCHEMAS);
      expect(r.issues.some((i) => i.message.includes('not found'))).toBe(true);
    });

    it('should accept system fields (_id, _createdAt, _updatedAt)', () => {
      const r = validateQuery({ collection: 'todos', filter: { _id: '123' } }, SCHEMAS);
      expect(r.valid).toBe(true);
    });

    it('should warn on unknown sort fields', () => {
      const r = validateQuery({ collection: 'todos', sort: { badField: 'asc' } }, SCHEMAS);
      expect(r.issues.some((i) => i.field === 'badField')).toBe(true);
    });
  });

  describe('operator validation', () => {
    it('should accept valid operators', () => {
      const r = validateQuery({ collection: 'todos', filter: { priority: { $gte: 3 } } }, SCHEMAS);
      expect(r.valid).toBe(true);
    });

    it('should reject unknown operators', () => {
      const r = validateQuery({ collection: 'todos', filter: { priority: { $badop: 1 } } }, SCHEMAS);
      expect(r.issues.some((i) => i.message.includes('Unknown operator'))).toBe(true);
    });

    it('should warn on type-incompatible operators', () => {
      const r = validateQuery({ collection: 'todos', filter: { title: { $gt: 5 } } }, SCHEMAS);
      expect(r.issues.some((i) => i.message.includes('may not be compatible'))).toBe(true);
    });

    it('should accept $regex on string fields', () => {
      const r = validateQuery({ collection: 'todos', filter: { title: { $regex: 'test' } } }, SCHEMAS);
      expect(r.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });
  });

  describe('pagination validation', () => {
    it('should accept valid pagination', () => {
      const r = validateQuery({ collection: 'todos', limit: 50, skip: 10 }, SCHEMAS);
      expect(r.valid).toBe(true);
    });

    it('should reject negative limit', () => {
      const r = validateQuery({ collection: 'todos', limit: -1 }, SCHEMAS);
      expect(r.issues.some((i) => i.message.includes('non-negative'))).toBe(true);
    });

    it('should warn on very high limit', () => {
      const r = validateQuery({ collection: 'todos', limit: 50_000 }, SCHEMAS);
      expect(r.issues.some((i) => i.message.includes('pagination'))).toBe(true);
    });
  });

  describe('logical operators', () => {
    it('should validate $and arrays', () => {
      const r = validateQuery({
        collection: 'todos',
        filter: { $and: [{ completed: false }, { priority: { $gte: 3 } }] },
      }, SCHEMAS);
      expect(r.valid).toBe(true);
    });

    it('should reject non-array $or', () => {
      const r = validateQuery({
        collection: 'todos',
        filter: { $or: 'invalid' as unknown },
      }, SCHEMAS);
      expect(r.issues.some((i) => i.message.includes('must be an array'))).toBe(true);
    });
  });

  describe('quickValidateQuery', () => {
    it('should return OK for valid query', () => {
      expect(quickValidateQuery({ collection: 'todos' }, SCHEMAS)).toBe('OK');
    });

    it('should return INVALID for bad query', () => {
      const result = quickValidateQuery({ collection: 'bad' }, SCHEMAS);
      expect(result).toContain('INVALID');
    });

    it('should mention warnings', () => {
      const result = quickValidateQuery({ collection: 'todos', filter: { unknown: 1 } }, SCHEMAS);
      expect(result).toContain('warning');
    });
  });
});
