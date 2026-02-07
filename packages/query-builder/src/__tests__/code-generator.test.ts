import { describe, it, expect } from 'vitest';
import { QueryCodeGenerator, createQueryCodeGenerator } from '../code-generator.js';
import { VisualQueryModel, createVisualQueryModel } from '../visual-query-model.js';

describe('QueryCodeGenerator', () => {
  it('should generate TypeScript in fluent style', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');
    model.addSort('name', 'asc');
    model.setLimit(10);

    const generator = createQueryCodeGenerator({ style: 'fluent' });
    const code = generator.generateTypeScript(model);

    expect(code).toContain("createQueryBuilder('users')");
    expect(code).toContain(".where('status', 'eq', 'active')");
    expect(code).toContain(".orderBy('name', 'asc')");
    expect(code).toContain('.limit(10)');
    expect(code).toContain('.build()');
    expect(code).toContain("import { createQueryBuilder } from '@pocket/query-builder'");
  });

  it('should generate TypeScript in object style', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');

    const generator = createQueryCodeGenerator({ style: 'object' });
    const code = generator.generateTypeScript(model);

    expect(code).toContain("import type { QueryPlan } from '@pocket/query-builder'");
    expect(code).toContain('const query: QueryPlan');
    expect(code).toContain('"collection": "users"');
  });

  it('should generate TypeScript with namespace import', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');

    const generator = createQueryCodeGenerator({ style: 'fluent', importStyle: 'namespace' });
    const code = generator.generateTypeScript(model);

    expect(code).toContain("import * as qb from '@pocket/query-builder'");
    expect(code).toContain("qb.createQueryBuilder('users')");
  });

  it('should generate SQL from model', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');
    model.addSort('name', 'asc');
    model.setLimit(10);

    const generator = createQueryCodeGenerator();
    const sql = generator.generateSQL(model);

    expect(sql).toContain('SELECT *');
    expect(sql).toContain('FROM users');
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('ORDER BY name ASC');
    expect(sql).toContain('LIMIT 10');
  });

  it('should generate JSON from model', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');

    const generator = createQueryCodeGenerator();
    const json = generator.generateJSON(model);
    const parsed = JSON.parse(json);

    expect(parsed.collection).toBe('users');
    expect(parsed.where).toBeDefined();
    expect(parsed.where.conditions).toHaveLength(1);
  });

  it('should handle multiple filters', () => {
    const model = createVisualQueryModel('products');
    model.addFilter('price', 'gte', 10);
    model.addFilter('category', 'eq', 'electronics');

    const generator = createQueryCodeGenerator();
    const sql = generator.generateSQL(model);

    expect(sql).toContain('price >= 10');
    expect(sql).toContain("category = 'electronics'");
  });

  it('should handle sort clauses in SQL', () => {
    const model = createVisualQueryModel('products');
    model.addSort('price', 'desc');
    model.addSort('name', 'asc');

    const generator = createQueryCodeGenerator();
    const sql = generator.generateSQL(model);

    expect(sql).toContain('ORDER BY price DESC, name ASC');
  });

  it('should handle aggregates in SQL', () => {
    const model = createVisualQueryModel('orders');
    model.addAggregate('count', '*');
    model.addAggregate('sum', 'amount');

    const generator = createQueryCodeGenerator();
    const sql = generator.generateSQL(model);

    expect(sql).toContain('SELECT COUNT(*)');
    expect(sql).toContain('SUM(amount)');
  });

  it('should generate Pocket query format', () => {
    const model = createVisualQueryModel('users');
    model.addFilter('status', 'eq', 'active');
    model.setLimit(5);

    const generator = createQueryCodeGenerator();
    const plan = generator.generatePocketQuery(model);

    expect(plan.collection).toBe('users');
    expect(plan.where).toBeDefined();
    expect(plan.pagination).toEqual({ limit: 5 });
  });

  it('should use default options when none provided', () => {
    const generator = new QueryCodeGenerator();
    const model = createVisualQueryModel('users');
    const code = generator.generateTypeScript(model);

    expect(code).toContain("import { createQueryBuilder } from '@pocket/query-builder'");
    expect(code).toContain("createQueryBuilder('users')");
  });
});
