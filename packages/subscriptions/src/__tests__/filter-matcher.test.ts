import { describe, expect, it } from 'vitest';
import { FilterMatcher, createFilterMatcher } from '../filter-matcher.js';

describe('FilterMatcher (extended)', () => {
  const matcher = new FilterMatcher();

  describe('createFilterMatcher factory', () => {
    it('returns a FilterMatcher instance', () => {
      const m = createFilterMatcher();
      expect(m).toBeInstanceOf(FilterMatcher);
    });

    it('works identically to direct construction', () => {
      const m = createFilterMatcher();
      expect(m.matches({ _id: '1', x: 1 }, { x: 1 })).toBe(true);
    });
  });

  describe('null/undefined edge cases', () => {
    it('matches everything when filter is null-ish', () => {
      expect(matcher.matches({ _id: '1' }, null as unknown as Record<string, unknown>)).toBe(true);
      expect(matcher.matches({ _id: '1' }, undefined as unknown as Record<string, unknown>)).toBe(
        true
      );
    });

    it('handles null doc gracefully for field access', () => {
      expect(matcher.matches(null, { name: 'Alice' })).toBe(false);
    });

    it('handles undefined doc gracefully for field access', () => {
      expect(matcher.matches(undefined, { name: 'Alice' })).toBe(false);
    });

    it('handles field value being undefined for implicit $eq', () => {
      expect(matcher.matches({ _id: '1' }, { missing: 'value' })).toBe(false);
    });

    it('matches undefined to undefined with implicit $eq', () => {
      expect(matcher.matches({ _id: '1' }, { missing: undefined })).toBe(true);
    });
  });

  describe('deeply nested paths', () => {
    it('resolves multi-level nested paths', () => {
      const doc = { _id: '1', a: { b: { c: { d: 42 } } } };
      expect(matcher.matches(doc, { 'a.b.c.d': 42 })).toBe(true);
      expect(matcher.matches(doc, { 'a.b.c.d': 99 })).toBe(false);
    });

    it('returns undefined for broken chain (non-object intermediate)', () => {
      const doc = { _id: '1', a: 'string' };
      expect(matcher.matches(doc, { 'a.b.c': 'value' })).toBe(false);
    });

    it('returns undefined for null intermediate', () => {
      const doc = { _id: '1', a: { b: null } };
      expect(matcher.matches(doc, { 'a.b.c': 'value' })).toBe(false);
    });
  });

  describe('$eq edge cases', () => {
    it('compares arrays element by element', () => {
      expect(matcher.matches({ _id: '1', tags: [1, 2, 3] }, { tags: { $eq: [1, 2, 3] } })).toBe(
        true
      );
      expect(matcher.matches({ _id: '1', tags: [1, 2, 3] }, { tags: { $eq: [1, 2] } })).toBe(false);
      expect(matcher.matches({ _id: '1', tags: [1, 2] }, { tags: { $eq: [1, 2, 3] } })).toBe(false);
    });

    it('handles Date equality', () => {
      const d = new Date('2024-01-01');
      const d2 = new Date('2024-01-01');
      expect(matcher.matches({ _id: '1', created: d }, { created: { $eq: d2 } })).toBe(true);
    });

    it('does not match different types', () => {
      expect(matcher.matches({ _id: '1', x: '5' }, { x: { $eq: 5 } })).toBe(false);
    });
  });

  describe('$ne edge cases', () => {
    it('returns true when field is missing and compared to a value', () => {
      expect(matcher.matches({ _id: '1' }, { missing: { $ne: 'value' } })).toBe(true);
    });

    it('returns false for same value', () => {
      expect(matcher.matches({ _id: '1', x: null }, { x: { $ne: null } })).toBe(false);
    });
  });

  describe('comparison operators with different types', () => {
    it('compares Date values with $gt/$lt', () => {
      const early = new Date('2024-01-01');
      const late = new Date('2024-12-31');
      expect(matcher.matches({ _id: '1', d: late }, { d: { $gt: early } })).toBe(true);
      expect(matcher.matches({ _id: '1', d: early }, { d: { $gt: late } })).toBe(false);
      expect(matcher.matches({ _id: '1', d: early }, { d: { $lt: late } })).toBe(true);
    });

    it('falls back to string comparison for mixed types', () => {
      // boolean vs string - falls back to String()
      expect(matcher.matches({ _id: '1', x: true }, { x: { $gt: false } })).toBe(true);
    });

    it('handles $gte with equal values', () => {
      expect(matcher.matches({ _id: '1', x: 'abc' }, { x: { $gte: 'abc' } })).toBe(true);
    });

    it('handles $lte with equal values', () => {
      expect(matcher.matches({ _id: '1', x: 'abc' }, { x: { $lte: 'abc' } })).toBe(true);
    });
  });

  describe('$in/$nin edge cases', () => {
    it('$in returns false when operand is not an array', () => {
      expect(
        matcher.matches({ _id: '1', x: 5 }, { x: { $in: 'not-array' as unknown as unknown[] } })
      ).toBe(false);
    });

    it('$nin returns true when operand is not an array', () => {
      expect(
        matcher.matches({ _id: '1', x: 5 }, { x: { $nin: 'not-array' as unknown as unknown[] } })
      ).toBe(true);
    });

    it('$in with empty array returns false', () => {
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $in: [] } })).toBe(false);
    });

    it('$nin with empty array returns true', () => {
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $nin: [] } })).toBe(true);
    });

    it('$in with null values', () => {
      expect(matcher.matches({ _id: '1', x: null }, { x: { $in: [null, 'a'] } })).toBe(true);
    });
  });

  describe('$exists edge cases', () => {
    it('$exists: true fails for explicitly undefined value', () => {
      expect(matcher.matches({ _id: '1', x: undefined }, { x: { $exists: true } })).toBe(false);
    });

    it('$exists: false succeeds for missing field', () => {
      expect(matcher.matches({ _id: '1' }, { x: { $exists: false } })).toBe(true);
    });

    it('$exists: true succeeds for null value (field exists)', () => {
      expect(matcher.matches({ _id: '1', x: null }, { x: { $exists: true } })).toBe(true);
    });

    it('$exists: true succeeds for falsy values (0, empty string)', () => {
      expect(matcher.matches({ _id: '1', x: 0 }, { x: { $exists: true } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: '' }, { x: { $exists: true } })).toBe(true);
    });
  });

  describe('logical operators edge cases', () => {
    it('$and with non-array returns false', () => {
      expect(
        matcher.matches({ _id: '1' }, { $and: 'not-array' as unknown as Record<string, unknown>[] })
      ).toBe(false);
    });

    it('$or with non-array returns false', () => {
      expect(
        matcher.matches({ _id: '1' }, { $or: 'not-array' as unknown as Record<string, unknown>[] })
      ).toBe(false);
    });

    it('$and with empty array returns true (vacuous truth)', () => {
      expect(matcher.matches({ _id: '1' }, { $and: [] })).toBe(true);
    });

    it('$or with empty array returns false', () => {
      expect(matcher.matches({ _id: '1' }, { $or: [] })).toBe(false);
    });

    it('$not inverts a complex condition', () => {
      expect(
        matcher.matches({ _id: '1', age: 15, status: 'minor' }, { $not: { age: { $gte: 18 } } })
      ).toBe(true);
    });

    it('nested $and inside $or', () => {
      const filter = {
        $or: [{ $and: [{ age: { $gte: 18 } }, { status: 'active' }] }, { role: 'admin' }],
      };
      expect(matcher.matches({ _id: '1', age: 25, status: 'active' }, filter)).toBe(true);
      expect(matcher.matches({ _id: '1', role: 'admin' }, filter)).toBe(true);
      expect(matcher.matches({ _id: '1', age: 15, status: 'active' }, filter)).toBe(false);
    });

    it('nested $not inside $and', () => {
      const filter = {
        $and: [{ status: 'active' }, { $not: { role: 'banned' } }],
      };
      expect(matcher.matches({ _id: '1', status: 'active', role: 'user' }, filter)).toBe(true);
      expect(matcher.matches({ _id: '1', status: 'active', role: 'banned' }, filter)).toBe(false);
    });
  });

  describe('unknown operators', () => {
    it('skips unknown operators in lenient mode', () => {
      expect(
        matcher.matches(
          { _id: '1', x: 5 },
          { x: { $regex: '.*' } as unknown as Record<string, unknown> }
        )
      ).toBe(true);
    });

    it('unknown operator combined with known ones', () => {
      expect(
        matcher.matches(
          { _id: '1', x: 5 },
          { x: { $gt: 3, $unknown: true } as unknown as Record<string, unknown> }
        )
      ).toBe(true);
    });
  });

  describe('operator detection', () => {
    it('treats objects without $ keys as implicit $eq', () => {
      // An object value without $ keys is treated as implicit $eq
      const obj = { nested: 'value' };
      expect(matcher.matches({ _id: '1', data: obj }, { data: obj })).toBe(true);
    });

    it('empty object is not an operator object and uses reference $eq', () => {
      // Empty object has no keys starting with $, so treated as implicit $eq.
      // Different object references → false (evalEq uses ===)
      expect(matcher.matches({ _id: '1', data: {} }, { data: {} })).toBe(false);
      // Same reference → true
      const obj = {};
      expect(matcher.matches({ _id: '1', data: obj }, { data: obj })).toBe(true);
    });
  });

  describe('multiple operators on same field', () => {
    it('applies all operators (range query)', () => {
      expect(matcher.matches({ _id: '1', x: 5 }, { x: { $gte: 1, $lte: 10 } })).toBe(true);
      expect(matcher.matches({ _id: '1', x: 0 }, { x: { $gte: 1, $lte: 10 } })).toBe(false);
      expect(matcher.matches({ _id: '1', x: 11 }, { x: { $gte: 1, $lte: 10 } })).toBe(false);
    });

    it('applies $ne and $in together', () => {
      expect(
        matcher.matches(
          { _id: '1', status: 'active' },
          { status: { $in: ['active', 'pending'], $ne: 'pending' } }
        )
      ).toBe(true);
      expect(
        matcher.matches(
          { _id: '1', status: 'pending' },
          { status: { $in: ['active', 'pending'], $ne: 'pending' } }
        )
      ).toBe(false);
    });
  });
});
