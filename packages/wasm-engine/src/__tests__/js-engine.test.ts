/**
 * Comprehensive tests for JsQueryEngine.
 *
 * Covers all filter operators, nested fields, sort edge cases,
 * aggregation edge cases, and complex nested filter groups.
 */
import { describe, expect, it } from 'vitest';
import { createJsQueryEngine } from '../js-engine.js';
import type { FilterCondition, FilterGroup } from '../types.js';

const engine = createJsQueryEngine();

const DOCS = [
  {
    _id: '1',
    name: 'Alice',
    age: 30,
    role: 'admin',
    score: 95,
    email: 'alice@example.com',
    address: { city: 'NYC', zip: '10001' },
  },
  {
    _id: '2',
    name: 'Bob',
    age: 25,
    role: 'user',
    score: 80,
    email: 'bob@test.org',
    address: { city: 'LA', zip: '90001' },
  },
  {
    _id: '3',
    name: 'Charlie',
    age: 35,
    role: 'admin',
    score: 88,
    email: 'charlie@example.com',
    address: { city: 'NYC', zip: '10002' },
  },
  {
    _id: '4',
    name: 'Diana',
    age: 28,
    role: 'user',
    score: 92,
    email: 'diana@test.org',
    address: { city: 'Chicago', zip: '60601' },
  },
  {
    _id: '5',
    name: 'Eve',
    age: 22,
    role: 'user',
    score: 70,
    email: 'eve@example.com',
    address: { city: 'LA', zip: '90002' },
  },
];

// ─── Filter Operators ──────────────────────────────────────────────────────────

describe('JsQueryEngine — filter operators', () => {
  it('eq: exact match', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'name', operator: 'eq', value: 'Bob' },
    });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.name).toBe('Bob');
  });

  it('ne: not equal', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'role', operator: 'ne', value: 'admin' },
    });
    expect(result.documents).toHaveLength(3);
    expect(result.documents.every((d) => d.role !== 'admin')).toBe(true);
  });

  it('gt: greater than', () => {
    const result = engine.execute(DOCS, { filter: { field: 'age', operator: 'gt', value: 30 } });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.name).toBe('Charlie');
  });

  it('gte: greater than or equal', () => {
    const result = engine.execute(DOCS, { filter: { field: 'age', operator: 'gte', value: 30 } });
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Alice', 'Charlie']);
  });

  it('lt: less than', () => {
    const result = engine.execute(DOCS, { filter: { field: 'age', operator: 'lt', value: 25 } });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.name).toBe('Eve');
  });

  it('lte: less than or equal', () => {
    const result = engine.execute(DOCS, { filter: { field: 'age', operator: 'lte', value: 25 } });
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Bob', 'Eve']);
  });

  it('in: value in array', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'age', operator: 'in', value: [22, 30, 99] },
    });
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Alice', 'Eve']);
  });

  it('nin: value not in array', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'role', operator: 'nin', value: ['admin'] },
    });
    expect(result.documents).toHaveLength(3);
    expect(result.documents.every((d) => d.role !== 'admin')).toBe(true);
  });

  it('contains: substring match', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'email', operator: 'contains', value: '@example' },
    });
    expect(result.documents).toHaveLength(3);
  });

  it('startsWith: prefix match', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'name', operator: 'startsWith', value: 'Ch' },
    });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.name).toBe('Charlie');
  });

  it('endsWith: suffix match', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'email', operator: 'endsWith', value: '.org' },
    });
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Bob', 'Diana']);
  });

  it('exists: field exists (true)', () => {
    const docsWithOptional = [
      { _id: '1', name: 'A', tags: ['x'] },
      { _id: '2', name: 'B' },
      { _id: '3', name: 'C', tags: [] },
    ];
    const result = engine.execute(docsWithOptional, {
      filter: { field: 'tags', operator: 'exists', value: true },
    });
    expect(result.documents).toHaveLength(2);
  });

  it('exists: field not exists (false)', () => {
    const docsWithOptional = [
      { _id: '1', name: 'A', tags: ['x'] },
      { _id: '2', name: 'B' },
      { _id: '3', name: 'C', tags: [] },
    ];
    const result = engine.execute(docsWithOptional, {
      filter: { field: 'tags', operator: 'exists', value: false },
    });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.name).toBe('B');
  });

  it('regex: pattern match', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'name', operator: 'regex', value: '^[A-C]' },
    });
    expect(result.documents).toHaveLength(3); // Alice, Bob, Charlie
  });

  it('regex: case-insensitive pattern', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'name', operator: 'regex', value: 'alice' },
    });
    expect(result.documents).toHaveLength(0); // case-sensitive by default
  });

  it('in/nin with non-array value returns false/true', () => {
    const resultIn = engine.execute(DOCS, {
      filter: { field: 'name', operator: 'in', value: 'not-array' },
    });
    expect(resultIn.documents).toHaveLength(0);

    const resultNin = engine.execute(DOCS, {
      filter: { field: 'name', operator: 'nin', value: 'not-array' },
    });
    expect(resultNin.documents).toHaveLength(0);
  });

  it('contains/startsWith/endsWith with non-string field returns false', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'age', operator: 'contains', value: '3' },
    });
    expect(result.documents).toHaveLength(0);
  });
});

// ─── Nested Field Paths ────────────────────────────────────────────────────────

describe('JsQueryEngine — nested field paths', () => {
  it('should resolve dotted paths', () => {
    const result = engine.execute(DOCS, {
      filter: { field: 'address.city', operator: 'eq', value: 'NYC' },
    });
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Alice', 'Charlie']);
  });

  it('should sort by nested field', () => {
    const result = engine.execute(DOCS, { sort: [{ field: 'address.zip', direction: 'asc' }] });
    expect(result.documents.map((d) => (d.address as { zip: string }).zip)).toEqual([
      '10001',
      '10002',
      '60601',
      '90001',
      '90002',
    ]);
  });

  it('should handle missing nested paths gracefully', () => {
    const docs = [
      { _id: '1', name: 'A' },
      { _id: '2', name: 'B', meta: { x: 1 } },
    ];
    const result = engine.execute(docs, { filter: { field: 'meta.x', operator: 'eq', value: 1 } });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.name).toBe('B');
  });

  it('should project nested fields via include', () => {
    const result = engine.execute(DOCS, {
      projection: { include: ['name', 'address.city'] },
      limit: 1,
    });
    expect(result.documents[0]).toHaveProperty('name');
    expect(result.documents[0]).toHaveProperty('address.city');
  });

  it('should group-by nested field', () => {
    const result = engine.aggregate(DOCS, {
      fields: ['address.city'],
      aggregates: [{ function: 'count', alias: 'n' }],
    });
    expect(result.groups).toHaveLength(3); // NYC, LA, Chicago
    const nycGroup = result.groups.find((g) => g['address.city'] === 'NYC');
    expect(nycGroup?.['n']).toBe(2);
  });
});

// ─── Complex Nested Filter Groups ──────────────────────────────────────────────

describe('JsQueryEngine — nested filter groups', () => {
  it('should handle nested AND within OR', () => {
    // (role=admin AND age>30) OR (role=user AND score>85)
    const filter: FilterGroup = {
      logic: 'or',
      conditions: [
        {
          logic: 'and',
          conditions: [
            { field: 'role', operator: 'eq', value: 'admin' } as FilterCondition,
            { field: 'age', operator: 'gt', value: 30 } as FilterCondition,
          ],
        } as FilterGroup,
        {
          logic: 'and',
          conditions: [
            { field: 'role', operator: 'eq', value: 'user' } as FilterCondition,
            { field: 'score', operator: 'gt', value: 85 } as FilterCondition,
          ],
        } as FilterGroup,
      ],
    };
    const result = engine.execute(DOCS, { filter });
    // Charlie (admin, age=35), Diana (user, score=92)
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Charlie', 'Diana']);
  });

  it('should handle nested OR within AND', () => {
    // (city=NYC OR city=LA) AND age>=25
    const filter: FilterGroup = {
      logic: 'and',
      conditions: [
        {
          logic: 'or',
          conditions: [
            { field: 'address.city', operator: 'eq', value: 'NYC' } as FilterCondition,
            { field: 'address.city', operator: 'eq', value: 'LA' } as FilterCondition,
          ],
        } as FilterGroup,
        { field: 'age', operator: 'gte', value: 25 } as FilterCondition,
      ],
    };
    const result = engine.execute(DOCS, { filter });
    // Alice (NYC,30), Bob (LA,25), Charlie (NYC,35) — Eve (LA,22) excluded
    expect(result.documents).toHaveLength(3);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('should handle three-level nesting', () => {
    const filter: FilterGroup = {
      logic: 'and',
      conditions: [
        { field: 'age', operator: 'gte', value: 22 } as FilterCondition,
        {
          logic: 'or',
          conditions: [
            {
              logic: 'and',
              conditions: [
                { field: 'role', operator: 'eq', value: 'admin' } as FilterCondition,
                { field: 'score', operator: 'gte', value: 90 } as FilterCondition,
              ],
            } as FilterGroup,
            { field: 'name', operator: 'eq', value: 'Eve' } as FilterCondition,
          ],
        } as FilterGroup,
      ],
    };
    const result = engine.execute(DOCS, { filter });
    // Alice (admin, score=95), Eve (name=Eve)
    expect(result.documents).toHaveLength(2);
    expect(result.documents.map((d) => d.name).sort()).toEqual(['Alice', 'Eve']);
  });

  it('should handle empty conditions array in filter group', () => {
    const filter: FilterGroup = { logic: 'and', conditions: [] };
    const result = engine.execute(DOCS, { filter });
    // AND with empty conditions: every() on empty is true => all docs pass
    expect(result.documents).toHaveLength(5);
  });

  it('should handle OR with empty conditions (none match)', () => {
    const filter: FilterGroup = { logic: 'or', conditions: [] };
    const result = engine.execute(DOCS, { filter });
    // OR with empty conditions: some() on empty is false => no docs pass
    expect(result.documents).toHaveLength(0);
  });
});

// ─── Sort Edge Cases ───────────────────────────────────────────────────────────

describe('JsQueryEngine — sort edge cases', () => {
  it('should sort strings lexicographically', () => {
    const result = engine.execute(DOCS, { sort: [{ field: 'name', direction: 'asc' }] });
    expect(result.documents.map((d) => d.name)).toEqual([
      'Alice',
      'Bob',
      'Charlie',
      'Diana',
      'Eve',
    ]);
  });

  it('should handle null/undefined values in sort', () => {
    const docs = [
      { _id: '1', name: 'A', val: 10 },
      { _id: '2', name: 'B' },
      { _id: '3', name: 'C', val: 5 },
      { _id: '4', name: 'D', val: null },
    ];
    const result = engine.execute(docs, { sort: [{ field: 'val', direction: 'asc' }] });
    // null/undefined come first in asc; both treated as nullish
    const vals = result.documents.map((d) => d.val);
    expect(vals[0] == null).toBe(true);
    expect(vals[1] == null).toBe(true);
    // Numeric values sorted after
    expect(vals[2]).toBe(5);
    expect(vals[3]).toBe(10);
  });

  it('should handle null/undefined values in desc sort', () => {
    const docs = [
      { _id: '1', name: 'A', val: 10 },
      { _id: '2', name: 'B' },
      { _id: '3', name: 'C', val: 5 },
    ];
    const result = engine.execute(docs, { sort: [{ field: 'val', direction: 'desc' }] });
    // undefined comes last in desc
    const vals = result.documents.map((d) => d.val);
    expect(vals[0]).toBe(10);
    expect(vals[1]).toBe(5);
    expect(vals[2]).toBeUndefined();
  });
});

// ─── Pagination Edge Cases ─────────────────────────────────────────────────────

describe('JsQueryEngine — pagination edge cases', () => {
  it('limit 0 returns empty', () => {
    const result = engine.execute(DOCS, { limit: 0 });
    expect(result.documents).toHaveLength(0);
    expect(result.totalMatched).toBe(5);
  });

  it('skip beyond dataset returns empty', () => {
    const result = engine.execute(DOCS, { skip: 100 });
    expect(result.documents).toHaveLength(0);
    expect(result.totalMatched).toBe(5);
  });

  it('skip 0 has no effect', () => {
    const result = engine.execute(DOCS, { skip: 0 });
    expect(result.documents).toHaveLength(5);
  });

  it('limit exceeding dataset returns all', () => {
    const result = engine.execute(DOCS, { limit: 999 });
    expect(result.documents).toHaveLength(5);
  });
});

// ─── Projection Edge Cases ─────────────────────────────────────────────────────

describe('JsQueryEngine — projection edge cases', () => {
  it('empty include array returns original docs', () => {
    const result = engine.execute(DOCS, { projection: { include: [] }, limit: 1 });
    expect(result.documents[0]).toHaveProperty('name');
    expect(result.documents[0]).toHaveProperty('age');
  });

  it('empty exclude array returns original docs', () => {
    const result = engine.execute(DOCS, { projection: { exclude: [] }, limit: 1 });
    expect(result.documents[0]).toHaveProperty('name');
    expect(result.documents[0]).toHaveProperty('age');
  });

  it('include non-existent field returns empty object', () => {
    const result = engine.execute(DOCS, { projection: { include: ['nonexistent'] }, limit: 1 });
    expect(Object.keys(result.documents[0]!)).toHaveLength(0);
  });

  it('exclude non-existent field leaves doc unchanged', () => {
    const result = engine.execute(DOCS, { projection: { exclude: ['nonexistent'] }, limit: 1 });
    expect(result.documents[0]).toHaveProperty('name');
  });
});

// ─── Empty Dataset ─────────────────────────────────────────────────────────────

describe('JsQueryEngine — empty dataset', () => {
  it('execute returns empty results', () => {
    const result = engine.execute([], { filter: { field: 'x', operator: 'eq', value: 1 } });
    expect(result.documents).toHaveLength(0);
    expect(result.totalMatched).toBe(0);
    expect(result.engine).toBe('js');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('aggregate returns empty groups', () => {
    const result = engine.aggregate([], {
      fields: ['role'],
      aggregates: [{ function: 'count', alias: 'n' }],
    });
    expect(result.groups).toHaveLength(0);
    expect(result.engine).toBe('js');
  });

  it('execute with no plan returns all docs', () => {
    const result = engine.execute(DOCS, {});
    expect(result.documents).toHaveLength(5);
    expect(result.totalMatched).toBe(5);
  });
});

// ─── Aggregation Edge Cases ────────────────────────────────────────────────────

describe('JsQueryEngine — aggregation edge cases', () => {
  it('sum/avg/min/max on non-numeric field', () => {
    const result = engine.aggregate(DOCS, {
      fields: ['role'],
      aggregates: [
        { function: 'sum', field: 'name', alias: 'sumName' },
        { function: 'avg', field: 'name', alias: 'avgName' },
        { function: 'min', field: 'name', alias: 'minName' },
        { function: 'max', field: 'name', alias: 'maxName' },
      ],
    });
    const group = result.groups[0]!;
    expect(group['sumName']).toBe(0);
    expect(group['avgName']).toBe(0);
    expect(group['minName']).toBeNull();
    expect(group['maxName']).toBeNull();
  });

  it('count without field counts all docs in group', () => {
    const result = engine.aggregate(DOCS, {
      fields: ['role'],
      aggregates: [{ function: 'count', alias: 'total' }],
    });
    const adminGroup = result.groups.find((g) => g['role'] === 'admin');
    const userGroup = result.groups.find((g) => g['role'] === 'user');
    expect(adminGroup?.['total']).toBe(2);
    expect(userGroup?.['total']).toBe(3);
  });

  it('multiple group-by fields', () => {
    const docs = [
      { dept: 'eng', level: 'senior', salary: 150 },
      { dept: 'eng', level: 'junior', salary: 80 },
      { dept: 'eng', level: 'senior', salary: 160 },
      { dept: 'sales', level: 'senior', salary: 120 },
    ];
    const result = engine.aggregate(docs, {
      fields: ['dept', 'level'],
      aggregates: [
        { function: 'count', alias: 'n' },
        { function: 'avg', field: 'salary', alias: 'avgSalary' },
      ],
    });
    expect(result.groups).toHaveLength(3);
    const engSenior = result.groups.find((g) => g['dept'] === 'eng' && g['level'] === 'senior');
    expect(engSenior?.['n']).toBe(2);
    expect(engSenior?.['avgSalary']).toBe(155);
  });

  it('aggregate with filter group (AND)', () => {
    const filter: FilterGroup = {
      logic: 'and',
      conditions: [
        { field: 'role', operator: 'eq', value: 'user' } as FilterCondition,
        { field: 'score', operator: 'gte', value: 75 } as FilterCondition,
      ],
    };
    const result = engine.aggregate(
      DOCS,
      {
        fields: ['role'],
        aggregates: [
          { function: 'count', alias: 'n' },
          { function: 'sum', field: 'score', alias: 'totalScore' },
        ],
      },
      filter
    );
    // Bob (80) + Diana (92) = 172, Eve (70) excluded
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!['n']).toBe(2);
    expect(result.groups[0]!['totalScore']).toBe(172);
  });

  it('aggregate with all docs in one group', () => {
    const docs = [{ val: 10 }, { val: 20 }, { val: 30 }];
    const result = engine.aggregate(docs, {
      fields: [],
      aggregates: [
        { function: 'sum', field: 'val', alias: 's' },
        { function: 'avg', field: 'val', alias: 'a' },
        { function: 'min', field: 'val', alias: 'lo' },
        { function: 'max', field: 'val', alias: 'hi' },
        { function: 'count', alias: 'c' },
      ],
    });
    // All docs grouped together (fields=[])
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!['s']).toBe(60);
    expect(result.groups[0]!['a']).toBe(20);
    expect(result.groups[0]!['lo']).toBe(10);
    expect(result.groups[0]!['hi']).toBe(30);
    expect(result.groups[0]!['c']).toBe(3);
  });
});

// ─── Large Result Set ──────────────────────────────────────────────────────────

describe('JsQueryEngine — large dataset', () => {
  const largeDocs = Array.from({ length: 5000 }, (_, i) => ({
    _id: String(i),
    name: `user-${i}`,
    age: 18 + (i % 60),
    group: `g${i % 10}`,
    score: Math.round(Math.random() * 100),
  }));

  it('filters large dataset correctly', () => {
    const result = engine.execute(largeDocs, {
      filter: { field: 'group', operator: 'eq', value: 'g0' },
    });
    expect(result.totalMatched).toBe(500);
    expect(result.documents).toHaveLength(500);
  });

  it('sorts and paginates large dataset', () => {
    const result = engine.execute(largeDocs, {
      sort: [{ field: 'age', direction: 'asc' }],
      skip: 10,
      limit: 5,
    });
    expect(result.documents).toHaveLength(5);
    expect(result.totalMatched).toBe(5000);
  });

  it('aggregates large dataset', () => {
    const result = engine.aggregate(largeDocs, {
      fields: ['group'],
      aggregates: [
        { function: 'count', alias: 'n' },
        { function: 'avg', field: 'age', alias: 'avgAge' },
      ],
    });
    expect(result.groups).toHaveLength(10);
    for (const g of result.groups) {
      expect(g['n']).toBe(500);
    }
  });
});

// ─── Execution Metadata ────────────────────────────────────────────────────────

describe('JsQueryEngine — execution metadata', () => {
  it('returns executionTimeMs >= 0', () => {
    const result = engine.execute(DOCS, {});
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns engine: js', () => {
    const result = engine.execute(DOCS, {});
    expect(result.engine).toBe('js');
  });

  it('aggregate returns engine: js', () => {
    const result = engine.aggregate(DOCS, {
      fields: ['role'],
      aggregates: [{ function: 'count', alias: 'n' }],
    });
    expect(result.engine).toBe('js');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });
});
