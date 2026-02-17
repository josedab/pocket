import { describe, expect, it } from 'vitest';

import { createPocketQLBuilder } from '../query-builder.js';
import { createQueryCompiler } from '../query-compiler.js';
import { createPocketQLExecutor } from '../query-executor.js';

interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  role: string;
  departmentId: string;
}

interface Department {
  id: string;
  name: string;
  budget: number;
}

const testUsers: User[] = [
  { id: '1', name: 'Alice', email: 'alice@test.com', age: 30, role: 'admin', departmentId: 'd1' },
  { id: '2', name: 'Bob', email: 'bob@test.com', age: 25, role: 'user', departmentId: 'd1' },
  { id: '3', name: 'Charlie', email: 'charlie@test.com', age: 35, role: 'admin', departmentId: 'd2' },
  { id: '4', name: 'Diana', email: 'diana@test.com', age: 28, role: 'user', departmentId: 'd2' },
  { id: '5', name: 'Eve', email: 'eve@test.com', age: 22, role: 'user', departmentId: 'd1' },
];

const testDepartments: Department[] = [
  { id: 'd1', name: 'Engineering', budget: 100000 },
  { id: 'd2', name: 'Marketing', budget: 50000 },
];

describe('PocketQL', () => {
  describe('QueryBuilder', () => {
    it('should build a basic query with where clause', () => {
      const query = createPocketQLBuilder<User>('users')
        .where('role', 'eq', 'admin')
        .build();

      expect(query.collection).toBe('users');
      expect(query.where).toHaveLength(1);
      expect(query.where[0]).toEqual({ field: 'role', operator: 'eq', value: 'admin' });
    });

    it('should chain multiple where clauses', () => {
      const query = createPocketQLBuilder<User>('users')
        .where('role', 'eq', 'admin')
        .where('age', 'gte', 30)
        .build();

      expect(query.where).toHaveLength(2);
      expect(query.where[0].field).toBe('role');
      expect(query.where[1].field).toBe('age');
    });

    it('should build query with sort and limit', () => {
      const query = createPocketQLBuilder<User>('users')
        .orderBy('age', 'desc')
        .limit(10)
        .build();

      expect(query.sort).toHaveLength(1);
      expect(query.sort[0]).toEqual({ field: 'age', direction: 'desc' });
      expect(query.limit).toBe(10);
    });

    it('should build query with skip', () => {
      const query = createPocketQLBuilder<User>('users')
        .skip(5)
        .limit(10)
        .build();

      expect(query.skip).toBe(5);
      expect(query.limit).toBe(10);
    });

    it('should build query with projection/select', () => {
      const query = createPocketQLBuilder<User>('users')
        .select('name', 'email')
        .build();

      expect(query.projection).toEqual({ name: true, email: true });
    });

    it('should build query with aggregations', () => {
      const query = createPocketQLBuilder<User>('users')
        .aggregate('age', 'avg', 'avgAge')
        .aggregate('age', 'max', 'maxAge')
        .build();

      expect(query.aggregates).toHaveLength(2);
      expect(query.aggregates[0]).toEqual({ field: 'age', operation: 'avg', alias: 'avgAge' });
      expect(query.aggregates[1]).toEqual({ field: 'age', operation: 'max', alias: 'maxAge' });
    });

    it('should build query with groupBy', () => {
      const query = createPocketQLBuilder<User>('users')
        .groupBy('role')
        .build();

      expect(query.groupBy).toBeTruthy();
      expect(query.groupBy!.fields).toEqual(['role']);
    });

    it('should build query with join', () => {
      const query = createPocketQLBuilder<User>('users')
        .join({
          collection: 'departments',
          localField: 'departmentId',
          foreignField: 'id',
          as: 'department',
          type: 'left',
        })
        .build();

      expect(query.joins).toHaveLength(1);
      expect(query.joins[0].collection).toBe('departments');
      expect(query.joins[0].type).toBe('left');
    });

    it('should support and/or logical groups', () => {
      const query = createPocketQLBuilder<User>('users')
        .or(
          { field: 'role', operator: 'eq', value: 'admin' },
          { field: 'age', operator: 'gte', value: 30 },
        )
        .build();

      expect(query.logicalGroups).toHaveLength(1);
      expect(query.logicalGroups[0].type).toBe('or');
      expect(query.logicalGroups[0].clauses).toHaveLength(2);
    });

    it('should generate human-readable toString()', () => {
      const str = createPocketQLBuilder<User>('users')
        .select('name', 'email')
        .where('role', 'eq', 'admin')
        .orderBy('name', 'asc')
        .limit(10)
        .toString();

      expect(str).toContain('SELECT name, email');
      expect(str).toContain('FROM users');
      expect(str).toContain('WHERE role eq "admin"');
      expect(str).toContain('ORDER BY name ASC');
      expect(str).toContain('LIMIT 10');
    });

    it('should generate SELECT * when no projection', () => {
      const str = createPocketQLBuilder<User>('users').toString();
      expect(str).toContain('SELECT *');
      expect(str).toContain('FROM users');
    });
  });

  describe('QueryCompiler', () => {
    const compiler = createQueryCompiler({ strict: true, maxResults: 1000 });

    it('should compile a query expression', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('role', 'eq', 'admin')
        .build();

      const compiled = compiler.compile(expression);
      expect(compiled.expression).toEqual(expression);
      expect(typeof compiled.filterFn).toBe('function');
    });

    it('should validate a valid query', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('age', 'gt', 18)
        .limit(50)
        .build();

      const result = compiler.validate(expression);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject query exceeding maxResults', () => {
      const expression = createPocketQLBuilder<User>('users')
        .limit(5000)
        .build();

      const result = compiler.validate(expression);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('maximum'))).toBe(true);
    });

    it('should reject negative limit in strict mode', () => {
      const expression = createPocketQLBuilder<User>('users')
        .limit(-1)
        .build();

      const result = compiler.validate(expression);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('positive'))).toBe(true);
    });

    it('should explain a query plan', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('role', 'eq', 'admin')
        .orderBy('age', 'desc')
        .limit(10)
        .build();

      const plan = compiler.explain(expression);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.estimatedCost).toBeGreaterThan(0);
      expect(typeof plan.usesIndex).toBe('boolean');
      expect(plan.steps[0].type).toBe('scan');
      expect(plan.steps.some((s) => s.type === 'filter')).toBe(true);
      expect(plan.steps.some((s) => s.type === 'sort')).toBe(true);
      expect(plan.steps.some((s) => s.type === 'limit')).toBe(true);
    });

    it('should optimize queries by reordering equality checks first', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('age', 'gt', 18)
        .where('role', 'eq', 'admin')
        .build();

      const optimized = compiler.optimize(expression);
      expect(optimized.where[0].operator).toBe('eq');
      expect(optimized.where[1].operator).toBe('gt');
    });
  });

  describe('QueryExecutor', () => {
    const compiler = createQueryCompiler();
    const executor = createPocketQLExecutor();

    it('should execute a simple where query', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('role', 'eq', 'admin')
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results).toHaveLength(2);
      expect(results.every((u) => u.role === 'admin')).toBe(true);
    });

    it('should execute query with multiple where clauses', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('role', 'eq', 'admin')
        .where('age', 'gte', 35)
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Charlie');
    });

    it('should execute query with sorting', () => {
      const expression = createPocketQLBuilder<User>('users')
        .orderBy('age', 'asc')
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results[0].name).toBe('Eve');
      expect(results[results.length - 1].name).toBe('Charlie');
    });

    it('should execute query with limit and skip', () => {
      const expression = createPocketQLBuilder<User>('users')
        .orderBy('age', 'asc')
        .skip(1)
        .limit(2)
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Bob');
      expect(results[1].name).toBe('Diana');
    });

    it('should execute query with projection', () => {
      const expression = createPocketQLBuilder<User>('users')
        .select('name', 'email')
        .limit(1)
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results).toHaveLength(1);
      expect(Object.keys(results[0])).toEqual(['name', 'email']);
    });

    it('should execute with or logical group', () => {
      const expression = createPocketQLBuilder<User>('users')
        .or(
          { field: 'name', operator: 'eq', value: 'Alice' },
          { field: 'name', operator: 'eq', value: 'Bob' },
        )
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results).toHaveLength(2);
    });

    it('should execute with string operators', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('name', 'startsWith', 'A')
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    it('should execute with in operator', () => {
      const expression = createPocketQLBuilder<User>('users')
        .where('role', 'in', ['admin'])
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.execute(compiled, testUsers);
      expect(results).toHaveLength(2);
    });

    it('should execute aggregate queries', () => {
      const expression = createPocketQLBuilder<User>('users')
        .aggregate('age', 'count', 'totalCount')
        .aggregate('age', 'sum', 'totalAge')
        .aggregate('age', 'avg', 'avgAge')
        .aggregate('age', 'min', 'minAge')
        .aggregate('age', 'max', 'maxAge')
        .build();

      const compiled = compiler.compile(expression);
      const result = executor.executeAggregate(compiled, testUsers);
      expect(result.totalCount).toBe(5);
      expect(result.totalAge).toBe(140);
      expect(result.avgAge).toBe(28);
      expect(result.minAge).toBe(22);
      expect(result.maxAge).toBe(35);
    });

    it('should execute join queries', () => {
      const expression = createPocketQLBuilder<User>('users')
        .join({
          collection: 'departments',
          localField: 'departmentId',
          foreignField: 'id',
          as: 'department',
          type: 'inner',
        })
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.executeJoin(compiled, testUsers, testDepartments);
      expect(results).toHaveLength(5);
      expect(results[0]).toHaveProperty('department');
    });

    it('should execute left join with no matches', () => {
      const usersWithBadDept: User[] = [
        { id: '99', name: 'Ghost', email: 'ghost@test.com', age: 40, role: 'user', departmentId: 'missing' },
      ];

      const expression = createPocketQLBuilder<User>('users')
        .join({
          collection: 'departments',
          localField: 'departmentId',
          foreignField: 'id',
          as: 'department',
          type: 'left',
        })
        .build();

      const compiled = compiler.compile(expression);
      const results = executor.executeJoin(compiled, usersWithBadDept, testDepartments);
      expect(results).toHaveLength(1);
      expect(results[0].department).toBeNull();
    });
  });
});
