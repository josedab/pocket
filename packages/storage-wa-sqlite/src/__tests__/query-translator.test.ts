import type { Document } from '@pocket/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { QueryTranslator } from '../query-translator.js';

// ── Test document type ──────────────────────────────────────────

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
  status?: string;
  email?: string;
  nested: { value: number; deep?: { level: string } };
}

// ── Tests ───────────────────────────────────────────────────────

describe('QueryTranslator', () => {
  let translator: QueryTranslator;

  beforeEach(() => {
    translator = new QueryTranslator();
  });

  // ── Comparison Operators ────────────────────────────────────

  describe('$eq operator', () => {
    it('should translate $eq with string', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $eq: 'hello' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') = ?");
      expect(result.params).toEqual(['hello']);
    });

    it('should translate $eq with number', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $eq: 42 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') = ?");
      expect(result.params).toEqual([42]);
    });

    it('should translate $eq with null to IS NULL', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $eq: null } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.status') IS NULL");
      expect(result.params).toEqual([]);
    });

    it('should translate $eq with boolean', () => {
      const result = translator.translate({
        filter: { active: { $eq: true } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.active') = ?");
      expect(result.params).toEqual([true]);
    });

    it('should translate $eq with zero', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $eq: 0 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') = ?");
      expect(result.params).toEqual([0]);
    });

    it('should translate $eq with empty string', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $eq: '' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') = ?");
      expect(result.params).toEqual(['']);
    });
  });

  describe('$ne operator', () => {
    it('should translate $ne with string', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $ne: 'deleted' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.status') != ?");
      expect(result.params).toEqual(['deleted']);
    });

    it('should translate $ne with null to IS NOT NULL', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $ne: null } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.status') IS NOT NULL");
      expect(result.params).toEqual([]);
    });

    it('should translate $ne with number', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $ne: 0 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') != ?");
      expect(result.params).toEqual([0]);
    });
  });

  describe('$gt operator', () => {
    it('should translate $gt with number', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $gt: 5 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') > ?");
      expect(result.params).toEqual([5]);
    });

    it('should translate $gt with negative number', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $gt: -10 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') > ?");
      expect(result.params).toEqual([-10]);
    });
  });

  describe('$gte operator', () => {
    it('should translate $gte', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $gte: 10 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') >= ?");
      expect(result.params).toEqual([10]);
    });
  });

  describe('$lt operator', () => {
    it('should translate $lt', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $lt: 100 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') < ?");
      expect(result.params).toEqual([100]);
    });
  });

  describe('$lte operator', () => {
    it('should translate $lte', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $lte: 50 } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') <= ?");
      expect(result.params).toEqual([50]);
    });
  });

  describe('multiple comparison operators on same field', () => {
    it('should combine $gt and $lt into range', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $gt: 5, $lt: 20 } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.count') > ?");
      expect(result.whereClause).toContain("json_extract(_data, '$.count') < ?");
      expect(result.whereClause).toContain(' AND ');
      expect(result.params).toEqual([5, 20]);
    });

    it('should combine $gte and $lte into inclusive range', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $gte: 10, $lte: 50 } },
      });
      expect(result.whereClause).toContain('>= ?');
      expect(result.whereClause).toContain('<= ?');
      expect(result.params).toEqual([10, 50]);
    });
  });

  // ── Set Operators ───────────────────────────────────────────

  describe('$in operator', () => {
    it('should translate $in with multiple values', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $in: ['active', 'pending'] } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.status') IN (?, ?)");
      expect(result.params).toEqual(['active', 'pending']);
    });

    it('should translate $in with single value', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $in: ['active'] } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.status') IN (?)");
      expect(result.params).toEqual(['active']);
    });

    it('should translate empty $in as always-false', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $in: [] } },
      });
      expect(result.whereClause).toBe('0 = 1');
      expect(result.params).toEqual([]);
    });

    it('should translate $in with numbers', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $in: [1, 2, 3] } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') IN (?, ?, ?)");
      expect(result.params).toEqual([1, 2, 3]);
    });
  });

  describe('$nin operator', () => {
    it('should translate $nin with values', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $nin: ['deleted', 'archived'] } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.status') NOT IN (?, ?)");
      expect(result.params).toEqual(['deleted', 'archived']);
    });

    it('should translate empty $nin as always-true', () => {
      const result = translator.translate<TestDoc>({
        filter: { status: { $nin: [] } },
      });
      expect(result.whereClause).toBe('1 = 1');
      expect(result.params).toEqual([]);
    });
  });

  // ── Existence Operator ──────────────────────────────────────

  describe('$exists operator', () => {
    it('should translate $exists: true to IS NOT NULL', () => {
      const result = translator.translate<TestDoc>({
        filter: { email: { $exists: true } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.email') IS NOT NULL");
      expect(result.params).toEqual([]);
    });

    it('should translate $exists: false to IS NULL', () => {
      const result = translator.translate<TestDoc>({
        filter: { email: { $exists: false } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.email') IS NULL");
      expect(result.params).toEqual([]);
    });
  });

  // ── String Operators ────────────────────────────────────────

  describe('$startsWith operator', () => {
    it('should translate $startsWith', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $startsWith: 'Hello' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['Hello%']);
    });

    it('should translate $startsWith with empty string', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $startsWith: '' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%']);
    });
  });

  describe('$endsWith operator', () => {
    it('should translate $endsWith', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $endsWith: 'world' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%world']);
    });
  });

  describe('$contains operator', () => {
    it('should translate $contains', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $contains: 'test' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%test%']);
    });

    it('should translate $contains with empty string', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $contains: '' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%%']);
    });
  });

  // ── Regex Operator ──────────────────────────────────────────

  describe('$regex operator', () => {
    it('should translate simple $regex string as substring match', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $regex: 'test' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%test%']);
    });

    it('should translate $regex with ^ anchor as starts-with', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $regex: '^Hello' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['Hello%']);
    });

    it('should translate $regex with $ anchor as ends-with', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $regex: 'world$' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%world']);
    });

    it('should handle complex regex with special chars via fallback', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $regex: 'foo.*bar' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      // Special regex chars are stripped
      expect(result.params).toEqual(['%foobar%']);
    });

    it('should handle $regex with ^ and special chars via fallback', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $regex: '^foo[0-9]+bar' } },
      });
      // hasRegexSpecialChars on "foo[0-9]+bar" returns true, so
      // it falls through to the complex regex fallback path
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params[0]).toMatch(/%.*%/);
    });

    it('should handle $regex with $ and special chars via fallback', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $regex: 'test(ing)?$' } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params[0]).toMatch(/%.*%/);
    });

    it('should handle non-string non-RegExp $regex as always-true', () => {
      const result = translator.translate({
        filter: { title: { $regex: 12345 } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe('1 = 1');
      expect(result.params).toEqual([]);
    });
  });

  describe('RegExp object as direct field value', () => {
    it('should translate RegExp with ^ as starts-with', () => {
      const result = translator.translate({
        filter: { title: /^Hello/ } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['Hello%']);
    });

    it('should translate RegExp with $ as ends-with', () => {
      const result = translator.translate({
        filter: { title: /world$/ } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%world']);
    });

    it('should translate simple RegExp as contains', () => {
      const result = translator.translate({
        filter: { title: /test/ } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%test%']);
    });

    it('should handle complex RegExp with special chars', () => {
      const result = translator.translate({
        filter: { title: /foo.*bar/ } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') LIKE ?");
      expect(result.params).toEqual(['%foobar%']);
    });
  });

  // ── Implicit $eq (Direct Values) ───────────────────────────

  describe('implicit $eq (direct values)', () => {
    it('should translate direct string value as $eq', () => {
      const result = translator.translate({
        filter: { title: 'hello' } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') = ?");
      expect(result.params).toEqual(['hello']);
    });

    it('should translate direct number value as $eq', () => {
      const result = translator.translate({
        filter: { count: 42 } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') = ?");
      expect(result.params).toEqual([42]);
    });

    it('should translate direct null as IS NULL', () => {
      const result = translator.translate({
        filter: { status: null } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.status') IS NULL");
      expect(result.params).toEqual([]);
    });

    it('should translate direct boolean value as $eq', () => {
      const result = translator.translate({
        filter: { active: false } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.active') = ?");
      expect(result.params).toEqual([false]);
    });
  });

  describe('plain object value (no operator keys)', () => {
    it('should treat plain object without operators as implicit $eq via JSON', () => {
      const plainObj = { foo: 'bar' };
      const result = translator.translate({
        filter: { metadata: plainObj } as Record<string, unknown>,
      });
      // Plain objects with no $ keys are JSON-stringified for equality comparison
      expect(result.whereClause).toBe("json_extract(_data, '$.metadata') = ?");
      expect(result.params).toEqual([JSON.stringify(plainObj)]);
    });
  });

  // ── Logical Operators ───────────────────────────────────────

  describe('$and operator', () => {
    it('should translate $and with two conditions', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $and: [{ count: { $gt: 5 } }, { count: { $lt: 20 } }],
        },
      });
      expect(result.whereClause).toBe(
        "(json_extract(_data, '$.count') > ? AND json_extract(_data, '$.count') < ?)"
      );
      expect(result.params).toEqual([5, 20]);
    });

    it('should translate $and with different fields', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $and: [{ title: { $eq: 'hello' } }, { count: { $gte: 10 } }],
        },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') = ?");
      expect(result.whereClause).toContain("json_extract(_data, '$.count') >= ?");
      expect(result.whereClause).toContain(' AND ');
      expect(result.params).toEqual(['hello', 10]);
    });

    it('should handle $and with single condition', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $and: [{ count: { $gt: 5 } }],
        },
      });
      expect(result.whereClause).toContain('> ?');
      expect(result.params).toEqual([5]);
    });

    it('should handle $and with empty array', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $and: [],
        },
      });
      expect(result.whereClause).toBe('');
    });
  });

  describe('$or operator', () => {
    it('should translate $or with two conditions', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $or: [{ status: { $eq: 'active' } }, { status: { $eq: 'pending' } }],
        },
      });
      expect(result.whereClause).toContain(' OR ');
      expect(result.params).toEqual(['active', 'pending']);
    });

    it('should handle $or with empty array', () => {
      const result = translator.translate<TestDoc>({
        filter: { $or: [] },
      });
      expect(result.whereClause).toBe('');
    });

    it('should translate $or with different fields', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $or: [{ title: { $startsWith: 'A' } }, { count: { $gt: 100 } }],
        },
      });
      expect(result.whereClause).toContain(' OR ');
      expect(result.params).toEqual(['A%', 100]);
    });
  });

  describe('$not operator', () => {
    it('should translate $not with a condition', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $not: { status: { $eq: 'deleted' } },
        },
      });
      expect(result.whereClause).toBe("NOT (json_extract(_data, '$.status') = ?)");
      expect(result.params).toEqual(['deleted']);
    });

    it('should translate $not with multiple field conditions', () => {
      const result = translator.translate({
        filter: {
          $not: { status: { $eq: 'deleted' }, count: { $lt: 0 } },
        } as Record<string, unknown>,
      });
      expect(result.whereClause).toContain('NOT (');
      expect(result.params).toEqual(['deleted', 0]);
    });
  });

  describe('$nor operator', () => {
    it('should translate $nor as NOT (... OR ...)', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $nor: [{ status: { $eq: 'deleted' } }, { status: { $eq: 'archived' } }],
        },
      });
      expect(result.whereClause).toContain('NOT (');
      expect(result.whereClause).toContain(' OR ');
      expect(result.params).toEqual(['deleted', 'archived']);
    });

    it('should handle $nor with empty array', () => {
      const result = translator.translate<TestDoc>({
        filter: { $nor: [] },
      });
      expect(result.whereClause).toBe('');
    });
  });

  describe('nested logical operators', () => {
    it('should handle $and inside $or', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $or: [
            {
              $and: [{ status: { $eq: 'active' } }, { count: { $gt: 10 } }],
            },
            { title: { $startsWith: 'VIP' } },
          ],
        },
      });
      expect(result.whereClause).toContain(' OR ');
      expect(result.whereClause).toContain(' AND ');
      expect(result.params).toEqual(['active', 10, 'VIP%']);
    });

    it('should handle $not inside $and', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $and: [{ $not: { status: { $eq: 'deleted' } } }, { count: { $gte: 1 } }],
        },
      });
      expect(result.whereClause).toContain('NOT (');
      expect(result.whereClause).toContain(' AND ');
      expect(result.params).toEqual(['deleted', 1]);
    });
  });

  // ── Unknown Operators ───────────────────────────────────────

  describe('unknown operators', () => {
    it('should skip unknown operators', () => {
      const result = translator.translate({
        filter: { title: { $unknownOp: 'value' } } as Record<string, unknown>,
      });
      // Unknown operators produce no clauses; plain object fallback triggers
      // with no valid operator clauses, it falls through to JSON equality
      expect(result.params).toHaveLength(1);
    });
  });

  // ── Internal Fields ─────────────────────────────────────────

  describe('internal fields', () => {
    it('should use direct column for _id', () => {
      const result = translator.translate<TestDoc>({
        filter: { _id: { $eq: 'abc' } },
      });
      expect(result.whereClause).toBe('_id = ?');
      expect(result.whereClause).not.toContain('json_extract');
    });

    it('should use direct column for _rev', () => {
      const result = translator.translate<TestDoc>({
        filter: { _rev: { $eq: '1-abc' } },
      });
      expect(result.whereClause).toBe('_rev = ?');
    });

    it('should use direct column for _deleted', () => {
      const result = translator.translate({
        filter: { _deleted: { $eq: 0 } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe('_deleted = ?');
    });

    it('should use direct column for _updatedAt', () => {
      const result = translator.translate<TestDoc>({
        filter: { _updatedAt: { $gt: 1000 } },
      });
      expect(result.whereClause).toBe('_updatedAt > ?');
    });

    it('should use direct column for _vclock', () => {
      const result = translator.translate({
        filter: { _vclock: { $exists: true } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe('_vclock IS NOT NULL');
    });
  });

  // ── Nested Fields ───────────────────────────────────────────

  describe('nested fields', () => {
    it('should handle dot-notation nested fields', () => {
      const result = translator.translate({
        filter: { 'nested.value': { $gt: 50 } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.nested.value') > ?");
      expect(result.params).toEqual([50]);
    });

    it('should handle deeply nested dot-notation fields', () => {
      const result = translator.translate({
        filter: { 'nested.deep.level': { $eq: 'high' } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.nested.deep.level') = ?");
      expect(result.params).toEqual(['high']);
    });

    it('should handle nested field with $in', () => {
      const result = translator.translate({
        filter: { 'nested.value': { $in: [1, 2, 3] } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.nested.value') IN (?, ?, ?)");
      expect(result.params).toEqual([1, 2, 3]);
    });
  });

  // ── Sort Translation ────────────────────────────────────────

  describe('sort translation', () => {
    it('should translate ascending sort on user field', () => {
      const result = translator.translate<TestDoc>({
        sort: [{ field: 'count', direction: 'asc' }],
      });
      expect(result.orderByClause).toBe("json_extract(_data, '$.count') ASC");
    });

    it('should translate descending sort', () => {
      const result = translator.translate<TestDoc>({
        sort: [{ field: 'count', direction: 'desc' }],
      });
      expect(result.orderByClause).toBe("json_extract(_data, '$.count') DESC");
    });

    it('should translate multiple sort fields', () => {
      const result = translator.translate<TestDoc>({
        sort: [
          { field: 'status', direction: 'asc' },
          { field: 'count', direction: 'desc' },
        ],
      });
      expect(result.orderByClause).toBe(
        "json_extract(_data, '$.status') ASC, json_extract(_data, '$.count') DESC"
      );
    });

    it('should handle internal field sort without json_extract', () => {
      const result = translator.translate<TestDoc>({
        sort: [{ field: '_updatedAt', direction: 'desc' }],
      });
      expect(result.orderByClause).toBe('_updatedAt DESC');
    });

    it('should handle _id sort without json_extract', () => {
      const result = translator.translate<TestDoc>({
        sort: [{ field: '_id', direction: 'asc' }],
      });
      expect(result.orderByClause).toBe('_id ASC');
    });

    it('should return empty string for no sort', () => {
      const result = translator.translate<TestDoc>({});
      expect(result.orderByClause).toBe('');
    });

    it('should return empty string for empty sort array', () => {
      const result = translator.translate<TestDoc>({
        sort: [],
      });
      expect(result.orderByClause).toBe('');
    });
  });

  // ── Pagination ──────────────────────────────────────────────

  describe('pagination', () => {
    it('should include limit', () => {
      const result = translator.translate<TestDoc>({ limit: 10 });
      expect(result.limit).toBe(10);
      expect(result.offset).toBeUndefined();
    });

    it('should include offset as skip', () => {
      const result = translator.translate<TestDoc>({ skip: 20 });
      expect(result.offset).toBe(20);
      expect(result.limit).toBeUndefined();
    });

    it('should include both limit and offset', () => {
      const result = translator.translate<TestDoc>({ limit: 10, skip: 20 });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
    });

    it('should handle limit of 0', () => {
      const result = translator.translate<TestDoc>({ limit: 0 });
      expect(result.limit).toBe(0);
    });

    it('should handle skip of 0', () => {
      const result = translator.translate<TestDoc>({ skip: 0 });
      expect(result.offset).toBe(0);
    });
  });

  // ── Empty / No-op Queries ──────────────────────────────────

  describe('empty and no-op queries', () => {
    it('should handle empty spec', () => {
      const result = translator.translate<TestDoc>({});
      expect(result.whereClause).toBe('');
      expect(result.orderByClause).toBe('');
      expect(result.params).toEqual([]);
      expect(result.limit).toBeUndefined();
      expect(result.offset).toBeUndefined();
    });

    it('should handle spec with empty filter', () => {
      const result = translator.translate<TestDoc>({ filter: {} });
      expect(result.whereClause).toBe('');
      expect(result.params).toEqual([]);
    });

    it('should skip undefined filter values', () => {
      const result = translator.translate({
        filter: { title: undefined, count: { $gt: 5 } } as Record<string, unknown>,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') > ?");
      expect(result.params).toEqual([5]);
    });
  });

  // ── Multiple Conditions in Filter ──────────────────────────

  describe('multiple field conditions', () => {
    it('should AND together multiple top-level field conditions', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $eq: 'hello' }, count: { $gt: 5 } },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') = ?");
      expect(result.whereClause).toContain("json_extract(_data, '$.count') > ?");
      expect(result.whereClause).toContain(' AND ');
      expect(result.params).toEqual(['hello', 5]);
    });

    it('should combine field conditions with logical $or', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          title: { $eq: 'specific' },
          $or: [{ count: { $lt: 5 } }, { count: { $gt: 100 } }],
        },
      });
      expect(result.whereClause).toContain("json_extract(_data, '$.title') = ?");
      expect(result.whereClause).toContain(' OR ');
      expect(result.params).toEqual(['specific', 5, 100]);
    });
  });

  // ── Special Characters in Values ───────────────────────────

  describe('special characters in values', () => {
    it('should handle values with single quotes via parameterization', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $eq: "it's a test" } },
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.title') = ?");
      expect(result.params).toEqual(["it's a test"]);
    });

    it('should handle values with percent signs in $contains', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $contains: '50%' } },
      });
      expect(result.params).toEqual(['%50%%']);
    });

    it('should handle values with newlines', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $eq: 'line1\nline2' } },
      });
      expect(result.params).toEqual(['line1\nline2']);
    });

    it('should handle values with unicode characters', () => {
      const result = translator.translate<TestDoc>({
        filter: { title: { $eq: '日本語テスト' } },
      });
      expect(result.params).toEqual(['日本語テスト']);
    });
  });

  // ── Full Combined Query Translation ─────────────────────────

  describe('full combined queries', () => {
    it('should translate filter + sort + limit + skip', () => {
      const result = translator.translate<TestDoc>({
        filter: { count: { $gt: 10 } },
        sort: [{ field: 'count', direction: 'asc' }],
        limit: 5,
        skip: 2,
      });
      expect(result.whereClause).toBe("json_extract(_data, '$.count') > ?");
      expect(result.orderByClause).toBe("json_extract(_data, '$.count') ASC");
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(2);
      expect(result.params).toEqual([10]);
    });

    it('should translate complex query with $or, $and, sort, and pagination', () => {
      const result = translator.translate<TestDoc>({
        filter: {
          $and: [
            {
              $or: [{ status: { $eq: 'active' } }, { count: { $gt: 100 } }],
            },
            { title: { $startsWith: 'A' } },
          ],
        },
        sort: [
          { field: '_updatedAt', direction: 'desc' },
          { field: 'title', direction: 'asc' },
        ],
        limit: 25,
        skip: 50,
      });

      expect(result.whereClause).toContain(' OR ');
      expect(result.whereClause).toContain(' AND ');
      expect(result.orderByClause).toContain('_updatedAt DESC');
      expect(result.orderByClause).toContain("json_extract(_data, '$.title') ASC");
      expect(result.limit).toBe(25);
      expect(result.offset).toBe(50);
      expect(result.params).toEqual(['active', 100, 'A%']);
    });
  });
});
