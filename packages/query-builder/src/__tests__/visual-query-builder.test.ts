import { describe, expect, it } from 'vitest';
import { VisualQueryBuilder } from '../visual-query-builder.js';

describe('VisualQueryBuilder', () => {
  it('should add and remove filters', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users');
    const id = qb.addFilter('age', 'gte', 18);

    const model = qb.getModel();
    expect(model.filters).toHaveLength(1);
    expect(model.filters[0]!.field).toBe('age');

    qb.removeFilter(id);
    expect(qb.getModel().filters).toHaveLength(0);
  });

  it('should toggle filters on/off', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users');
    const id = qb.addFilter('active', 'eq', true);

    qb.toggleFilter(id);
    expect(qb.getModel().filters[0]!.enabled).toBe(false);

    qb.toggleFilter(id);
    expect(qb.getModel().filters[0]!.enabled).toBe(true);
  });

  it('should manage sorts', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users');
    qb.addSort('name', 'asc');
    qb.addSort('age', 'desc');

    expect(qb.getModel().sorts).toHaveLength(2);

    qb.removeSort('name');
    expect(qb.getModel().sorts).toHaveLength(1);
  });

  it('should set limit and skip', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users').setLimit(10).setSkip(20);

    const model = qb.getModel();
    expect(model.limit).toBe(10);
    expect(model.skip).toBe(20);
  });

  it('should preview the query', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users');
    qb.addFilter('active', 'eq', true);
    qb.addFilter('age', 'gte', 18);
    qb.addSort('name', 'asc');

    const preview = qb.preview();
    expect(preview.filterObject.active).toBe(true);
    expect(preview.filterObject.age).toEqual({ $gte: 18 });
    expect(preview.sortObject.name).toBe('asc');
    expect(preview.estimatedComplexity).toBe('simple');
    expect(preview.fieldCount).toBe(2);
  });

  it('should export as TypeScript code', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('todos');
    qb.addFilter('completed', 'eq', false);
    qb.addSort('createdAt', 'desc');
    qb.setLimit(10);

    const code = qb.exportCode();
    expect(code.typescript).toContain("db.collection('todos')");
    expect(code.typescript).toContain('.find(');
    expect(code.typescript).toContain('.limit(10)');
    expect(code.typescript).toContain('.exec()');
  });

  it('should export as JSON', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('todos');
    qb.addFilter('status', 'in', ['active', 'pending']);

    const code = qb.exportCode();
    const parsed = JSON.parse(code.json);
    expect(parsed.collection).toBe('todos');
    expect(parsed.filter.status.$in).toEqual(['active', 'pending']);
  });

  it('should export as cURL', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users');
    const code = qb.exportCode();
    expect(code.curl).toContain('curl');
    expect(code.curl).toContain('Content-Type');
  });

  it('should reset the builder', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users');
    qb.addFilter('x', 'eq', 1);
    qb.addSort('y', 'asc');
    qb.reset();

    const model = qb.getModel();
    expect(model.collection).toBe('');
    expect(model.filters).toHaveLength(0);
    expect(model.sorts).toHaveLength(0);
  });

  it('should load a model', () => {
    const qb = new VisualQueryBuilder();
    qb.loadModel({
      collection: 'posts',
      filters: [{ id: 'f1', field: 'published', operator: 'eq', value: true, enabled: true }],
      sorts: [{ field: 'createdAt', direction: 'desc' }],
      limit: 20,
      skip: null,
      projection: null,
    });

    const model = qb.getModel();
    expect(model.collection).toBe('posts');
    expect(model.filters).toHaveLength(1);
    expect(model.limit).toBe(20);
  });

  it('should handle disabled filters in filter object', () => {
    const qb = new VisualQueryBuilder();
    qb.setCollection('users');
    const id = qb.addFilter('active', 'eq', true);
    qb.addFilter('age', 'gte', 18);
    qb.toggleFilter(id); // disable active filter

    const preview = qb.preview();
    expect(preview.filterObject.active).toBeUndefined();
    expect(preview.filterObject.age).toEqual({ $gte: 18 });
    expect(preview.fieldCount).toBe(1);
  });
});
