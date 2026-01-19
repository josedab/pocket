import { describe, expect, it } from 'vitest';
import type { Document } from '../types/document.js';
import {
  compareValues,
  getNestedValue,
  isEqual,
  isGreaterThan,
  isGreaterThanOrEqual,
  isLessThan,
  isLessThanOrEqual,
  matchesCondition,
  matchesFilter,
  setNestedValue,
} from './operators.js';

interface TestDoc extends Document {
  _id: string;
  title: string;
  count: number;
  tags: string[];
  nested: { value: number };
  createdAt: Date;
  completed: boolean;
}

describe('matchesCondition', () => {
  describe('direct equality', () => {
    it('should match primitive values', () => {
      expect(matchesCondition(5, 5)).toBe(true);
      expect(matchesCondition(5, 6)).toBe(false);
      expect(matchesCondition('hello', 'hello')).toBe(true);
      expect(matchesCondition('hello', 'world')).toBe(false);
    });

    it('should match null values', () => {
      expect(matchesCondition(null, null)).toBe(true);
      expect(matchesCondition(null, 'value')).toBe(false);
    });

    it('should match Date values', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-01');
      const date3 = new Date('2024-01-02');
      expect(matchesCondition(date1, date2)).toBe(true);
      expect(matchesCondition(date1, date3)).toBe(false);
    });

    it('should match RegExp values', () => {
      const regex1 = /test/i;
      const regex2 = /test/i;
      const regex3 = /test/g;
      expect(matchesCondition(regex1, regex2)).toBe(true);
      expect(matchesCondition(regex1, regex3)).toBe(false);
    });
  });

  describe('$eq operator', () => {
    it('should match equal values', () => {
      expect(matchesCondition(5, { $eq: 5 })).toBe(true);
      expect(matchesCondition(5, { $eq: 6 })).toBe(false);
    });
  });

  describe('$ne operator', () => {
    it('should match not equal values', () => {
      expect(matchesCondition(5, { $ne: 6 })).toBe(true);
      expect(matchesCondition(5, { $ne: 5 })).toBe(false);
    });
  });

  describe('$gt operator', () => {
    it('should match greater than values', () => {
      expect(matchesCondition(5, { $gt: 4 })).toBe(true);
      expect(matchesCondition(5, { $gt: 5 })).toBe(false);
      expect(matchesCondition(5, { $gt: 6 })).toBe(false);
    });

    it('should work with strings', () => {
      expect(matchesCondition('b', { $gt: 'a' })).toBe(true);
      expect(matchesCondition('a', { $gt: 'b' })).toBe(false);
    });
  });

  describe('$gte operator', () => {
    it('should match greater than or equal values', () => {
      expect(matchesCondition(5, { $gte: 4 })).toBe(true);
      expect(matchesCondition(5, { $gte: 5 })).toBe(true);
      expect(matchesCondition(5, { $gte: 6 })).toBe(false);
    });
  });

  describe('$lt operator', () => {
    it('should match less than values', () => {
      expect(matchesCondition(5, { $lt: 6 })).toBe(true);
      expect(matchesCondition(5, { $lt: 5 })).toBe(false);
      expect(matchesCondition(5, { $lt: 4 })).toBe(false);
    });
  });

  describe('$lte operator', () => {
    it('should match less than or equal values', () => {
      expect(matchesCondition(5, { $lte: 6 })).toBe(true);
      expect(matchesCondition(5, { $lte: 5 })).toBe(true);
      expect(matchesCondition(5, { $lte: 4 })).toBe(false);
    });
  });

  describe('$in operator', () => {
    it('should match values in array', () => {
      expect(matchesCondition(5, { $in: [1, 2, 5, 10] })).toBe(true);
      expect(matchesCondition(5, { $in: [1, 2, 3] })).toBe(false);
      expect(matchesCondition('hello', { $in: ['hello', 'world'] })).toBe(true);
    });
  });

  describe('$nin operator', () => {
    it('should match values not in array', () => {
      expect(matchesCondition(5, { $nin: [1, 2, 3] })).toBe(true);
      expect(matchesCondition(5, { $nin: [1, 2, 5, 10] })).toBe(false);
    });
  });

  describe('string operators', () => {
    it('should match $regex', () => {
      expect(matchesCondition('hello world', { $regex: /world/ })).toBe(true);
      expect(matchesCondition('hello world', { $regex: /foo/ })).toBe(false);
      expect(matchesCondition('Hello World', { $regex: /hello/i })).toBe(true);
    });

    it('should match $regex as string', () => {
      expect(matchesCondition('hello world', { $regex: 'world' })).toBe(true);
    });

    it('should reject invalid regex patterns', () => {
      // Invalid regex syntax should return false (no match)
      expect(matchesCondition('hello world', { $regex: '[invalid' })).toBe(false);
      expect(matchesCondition('hello world', { $regex: '(unclosed' })).toBe(false);
    });

    it('should reject potentially dangerous ReDoS patterns', () => {
      // Nested quantifiers that could cause catastrophic backtracking
      expect(matchesCondition('aaaaaaaaaaaaaaa', { $regex: '(a+)+b' })).toBe(false);
    });

    it('should reject overly long regex patterns', () => {
      // Pattern exceeding maximum length
      const longPattern = 'a'.repeat(1001);
      expect(matchesCondition('test', { $regex: longPattern })).toBe(false);
    });

    it('should match $startsWith', () => {
      expect(matchesCondition('hello world', { $startsWith: 'hello' })).toBe(true);
      expect(matchesCondition('hello world', { $startsWith: 'world' })).toBe(false);
    });

    it('should match $endsWith', () => {
      expect(matchesCondition('hello world', { $endsWith: 'world' })).toBe(true);
      expect(matchesCondition('hello world', { $endsWith: 'hello' })).toBe(false);
    });

    it('should match $contains', () => {
      expect(matchesCondition('hello world', { $contains: 'lo wo' })).toBe(true);
      expect(matchesCondition('hello world', { $contains: 'foo' })).toBe(false);
    });
  });

  describe('array operators', () => {
    it('should match $all', () => {
      expect(matchesCondition([1, 2, 3, 4], { $all: [1, 2] })).toBe(true);
      expect(matchesCondition([1, 2, 3, 4], { $all: [1, 5] })).toBe(false);
    });

    it('should match $size', () => {
      expect(matchesCondition([1, 2, 3], { $size: 3 })).toBe(true);
      expect(matchesCondition([1, 2, 3], { $size: 2 })).toBe(false);
    });

    it('should match $elemMatch', () => {
      expect(matchesCondition([1, 5, 10], { $elemMatch: { $gt: 7 } })).toBe(true);
      expect(matchesCondition([1, 5, 6], { $elemMatch: { $gt: 7 } })).toBe(false);
    });
  });

  describe('combined operators', () => {
    it('should match multiple conditions', () => {
      expect(matchesCondition(5, { $gt: 3, $lt: 10 })).toBe(true);
      expect(matchesCondition(5, { $gt: 3, $lt: 4 })).toBe(false);
    });
  });
});

describe('matchesFilter', () => {
  const doc: TestDoc = {
    _id: '1',
    title: 'Test Document',
    count: 42,
    tags: ['alpha', 'beta'],
    nested: { value: 100 },
    createdAt: new Date('2024-01-15'),
    completed: true,
  };

  it('should match simple field conditions', () => {
    expect(matchesFilter(doc, { title: 'Test Document' })).toBe(true);
    expect(matchesFilter(doc, { title: 'Other' })).toBe(false);
    expect(matchesFilter(doc, { count: 42 })).toBe(true);
    expect(matchesFilter(doc, { count: { $gt: 40 } })).toBe(true);
  });

  it('should match nested fields with dot notation', () => {
    expect(matchesFilter(doc, { 'nested.value': 100 })).toBe(true);
    expect(matchesFilter(doc, { 'nested.value': { $gt: 50 } })).toBe(true);
  });

  it('should handle $and operator', () => {
    expect(
      matchesFilter(doc, {
        $and: [{ count: { $gt: 40 } }, { completed: true }],
      })
    ).toBe(true);
    expect(
      matchesFilter(doc, {
        $and: [{ count: { $gt: 40 } }, { completed: false }],
      })
    ).toBe(false);
  });

  it('should handle $or operator', () => {
    expect(
      matchesFilter(doc, {
        $or: [{ count: 0 }, { title: 'Test Document' }],
      })
    ).toBe(true);
    expect(
      matchesFilter(doc, {
        $or: [{ count: 0 }, { title: 'Other' }],
      })
    ).toBe(false);
  });

  it('should handle $not operator', () => {
    expect(matchesFilter(doc, { $not: { count: 0 } })).toBe(true);
    expect(matchesFilter(doc, { $not: { count: 42 } })).toBe(false);
  });

  it('should handle $nor operator', () => {
    expect(
      matchesFilter(doc, {
        $nor: [{ count: 0 }, { title: 'Other' }],
      })
    ).toBe(true);
    expect(
      matchesFilter(doc, {
        $nor: [{ count: 42 }, { title: 'Other' }],
      })
    ).toBe(false);
  });

  it('should handle complex nested filters', () => {
    expect(
      matchesFilter(doc, {
        $and: [
          { count: { $gte: 40, $lte: 50 } },
          { $or: [{ completed: true }, { 'nested.value': { $lt: 50 } }] },
        ],
      })
    ).toBe(true);
  });
});

describe('getNestedValue', () => {
  const obj = {
    level1: {
      level2: {
        level3: 'deep value',
      },
      array: [1, 2, 3],
    },
    simple: 'value',
  };

  it('should get top-level values', () => {
    expect(getNestedValue(obj, 'simple')).toBe('value');
  });

  it('should get nested values with dot notation', () => {
    expect(getNestedValue(obj, 'level1.level2.level3')).toBe('deep value');
    expect(getNestedValue(obj, 'level1.array')).toEqual([1, 2, 3]);
  });

  it('should return undefined for missing paths', () => {
    expect(getNestedValue(obj, 'missing')).toBeUndefined();
    expect(getNestedValue(obj, 'level1.missing')).toBeUndefined();
    expect(getNestedValue(obj, 'level1.missing.deep')).toBeUndefined();
  });

  it('should handle null and undefined', () => {
    expect(getNestedValue(null, 'any')).toBeUndefined();
    expect(getNestedValue(undefined, 'any')).toBeUndefined();
  });
});

describe('setNestedValue', () => {
  it('should set top-level values', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'key', 'value');
    expect(obj.key).toBe('value');
  });

  it('should set nested values', () => {
    const obj: Record<string, unknown> = {};
    setNestedValue(obj, 'level1.level2.key', 'deep');
    expect(obj.level1 as Record<string, unknown>).toEqual({ level2: { key: 'deep' } });
  });

  it('should create intermediate objects', () => {
    const obj: Record<string, unknown> = { existing: 'value' };
    setNestedValue(obj, 'new.path.key', 'value');
    expect(obj.existing).toBe('value');
    expect(getNestedValue(obj, 'new.path.key')).toBe('value');
  });
});

describe('isEqual', () => {
  it('should compare primitives', () => {
    expect(isEqual(5, 5)).toBe(true);
    expect(isEqual(5, 6)).toBe(false);
    expect(isEqual('a', 'a')).toBe(true);
    expect(isEqual('a', 'b')).toBe(false);
    expect(isEqual(true, true)).toBe(true);
    expect(isEqual(true, false)).toBe(false);
  });

  it('should compare null', () => {
    expect(isEqual(null, null)).toBe(true);
    expect(isEqual(null, undefined)).toBe(false);
    expect(isEqual(null, 0)).toBe(false);
  });

  it('should compare dates', () => {
    const date1 = new Date('2024-01-01');
    const date2 = new Date('2024-01-01');
    const date3 = new Date('2024-01-02');
    expect(isEqual(date1, date2)).toBe(true);
    expect(isEqual(date1, date3)).toBe(false);
  });

  it('should compare arrays', () => {
    expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(isEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('should compare objects', () => {
    expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(isEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('should compare nested structures', () => {
    expect(isEqual({ a: { b: [1, 2, 3] } }, { a: { b: [1, 2, 3] } })).toBe(true);
    expect(isEqual({ a: { b: [1, 2, 3] } }, { a: { b: [1, 2, 4] } })).toBe(false);
  });
});

describe('comparison functions', () => {
  describe('isGreaterThan', () => {
    it('should compare numbers', () => {
      expect(isGreaterThan(5, 3)).toBe(true);
      expect(isGreaterThan(3, 5)).toBe(false);
      expect(isGreaterThan(5, 5)).toBe(false);
    });

    it('should compare strings', () => {
      expect(isGreaterThan('b', 'a')).toBe(true);
      expect(isGreaterThan('a', 'b')).toBe(false);
    });

    it('should compare dates', () => {
      const date1 = new Date('2024-01-02');
      const date2 = new Date('2024-01-01');
      expect(isGreaterThan(date1, date2)).toBe(true);
      expect(isGreaterThan(date2, date1)).toBe(false);
    });
  });

  describe('isLessThan', () => {
    it('should compare numbers', () => {
      expect(isLessThan(3, 5)).toBe(true);
      expect(isLessThan(5, 3)).toBe(false);
    });
  });

  describe('isGreaterThanOrEqual', () => {
    it('should include equal values', () => {
      expect(isGreaterThanOrEqual(5, 5)).toBe(true);
      expect(isGreaterThanOrEqual(6, 5)).toBe(true);
      expect(isGreaterThanOrEqual(4, 5)).toBe(false);
    });
  });

  describe('isLessThanOrEqual', () => {
    it('should include equal values', () => {
      expect(isLessThanOrEqual(5, 5)).toBe(true);
      expect(isLessThanOrEqual(4, 5)).toBe(true);
      expect(isLessThanOrEqual(6, 5)).toBe(false);
    });
  });
});

describe('compareValues', () => {
  it('should return 0 for equal values', () => {
    expect(compareValues(5, 5)).toBe(0);
    expect(compareValues('a', 'a')).toBe(0);
  });

  it('should sort ascending by default', () => {
    expect(compareValues(3, 5)).toBeLessThan(0);
    expect(compareValues(5, 3)).toBeGreaterThan(0);
  });

  it('should sort descending when specified', () => {
    expect(compareValues(3, 5, 'desc')).toBeGreaterThan(0);
    expect(compareValues(5, 3, 'desc')).toBeLessThan(0);
  });

  it('should handle null and undefined', () => {
    expect(compareValues(null, 5)).toBeGreaterThan(0);
    expect(compareValues(5, null)).toBeLessThan(0);
    expect(compareValues(undefined, 5)).toBeGreaterThan(0);
  });

  it('should compare booleans', () => {
    expect(compareValues(true, false)).toBeGreaterThan(0);
    expect(compareValues(false, true)).toBeLessThan(0);
  });

  it('should use locale-aware string comparison', () => {
    expect(compareValues('apple', 'banana')).toBeLessThan(0);
    expect(compareValues('banana', 'apple')).toBeGreaterThan(0);
  });
});
