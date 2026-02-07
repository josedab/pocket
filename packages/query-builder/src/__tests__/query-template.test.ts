import { describe, it, expect } from 'vitest';
import { QueryTemplateRegistry, createQueryTemplateRegistry } from '../query-template.js';
import type { QueryTemplate } from '../query-template.js';

describe('QueryTemplateRegistry', () => {
  it('should register and retrieve a template', () => {
    const registry = createQueryTemplateRegistry();
    const template: QueryTemplate = {
      name: 'activeUsers',
      description: 'Find active users',
      collection: 'users',
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
      sorts: [{ field: 'name', direction: 'asc' }],
      params: [],
    };

    registry.register(template);
    const result = registry.get('activeUsers');

    expect(result).toBeDefined();
    expect(result!.name).toBe('activeUsers');
    expect(result!.collection).toBe('users');
  });

  it('should apply template with params', () => {
    const registry = new QueryTemplateRegistry();
    const template: QueryTemplate = {
      name: 'findByStatus',
      description: 'Find by status',
      collection: 'users',
      filters: [{ field: 'status', operator: 'eq', value: '{{status}}' }],
      sorts: [],
      params: [
        { name: 'status', type: 'string', description: 'The status to filter by' },
      ],
    };

    registry.register(template);
    const model = registry.applyTemplate('findByStatus', { status: 'active' });
    const plan = model.toQueryPlan();

    expect(plan.collection).toBe('users');
    expect(plan.where).toBeDefined();
    const condition = plan.where!.conditions[0] as { value: unknown };
    expect(condition.value).toBe('active');
  });

  it('should list all templates', () => {
    const registry = createQueryTemplateRegistry();
    registry.register({
      name: 'template1',
      description: 'First',
      collection: 'col1',
      filters: [],
      sorts: [],
      params: [],
    });
    registry.register({
      name: 'template2',
      description: 'Second',
      collection: 'col2',
      filters: [],
      sorts: [],
      params: [],
    });

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name)).toContain('template1');
    expect(list.map((t) => t.name)).toContain('template2');
  });

  it('should remove template', () => {
    const registry = createQueryTemplateRegistry();
    registry.register({
      name: 'toRemove',
      description: 'Will be removed',
      collection: 'col',
      filters: [],
      sorts: [],
      params: [],
    });

    expect(registry.get('toRemove')).toBeDefined();
    const removed = registry.remove('toRemove');
    expect(removed).toBe(true);
    expect(registry.get('toRemove')).toBeUndefined();
  });

  it('should get builtin templates', () => {
    const registry = createQueryTemplateRegistry();
    const builtins = registry.getBuiltinTemplates();

    expect(builtins.length).toBeGreaterThanOrEqual(4);
    const names = builtins.map((t) => t.name);
    expect(names).toContain('findById');
    expect(names).toContain('findRecent');
    expect(names).toContain('countByField');
    expect(names).toContain('topN');
  });

  it('should create valid VisualQueryModel from template', () => {
    const registry = createQueryTemplateRegistry();
    const builtins = registry.getBuiltinTemplates();
    for (const tpl of builtins) {
      registry.register(tpl);
    }

    const model = registry.applyTemplate('findById', {
      collection: 'users',
      id: '123',
    });

    const plan = model.toQueryPlan();
    expect(plan.collection).toBe('users');
    expect(plan.where).toBeDefined();
    expect(plan.where!.conditions).toHaveLength(1);
    const condition = plan.where!.conditions[0] as { field: string; value: unknown };
    expect(condition.field).toBe('id');
    expect(condition.value).toBe('123');
  });

  it('should throw when applying non-existent template', () => {
    const registry = createQueryTemplateRegistry();
    expect(() => registry.applyTemplate('nonExistent', {})).toThrow('Template "nonExistent" not found');
  });

  it('should apply template with sorts', () => {
    const registry = createQueryTemplateRegistry();
    const builtins = registry.getBuiltinTemplates();
    for (const tpl of builtins) {
      registry.register(tpl);
    }

    const model = registry.applyTemplate('findRecent', {
      collection: 'posts',
    });

    const plan = model.toQueryPlan();
    expect(plan.collection).toBe('posts');
    expect(plan.sort).toEqual([{ field: 'createdAt', direction: 'desc' }]);
  });

  it('should use default values for missing params', () => {
    const registry = createQueryTemplateRegistry();
    registry.register({
      name: 'withDefaults',
      description: 'Template with defaults',
      collection: 'items',
      filters: [{ field: 'limit', operator: 'eq', value: '{{maxItems}}' }],
      sorts: [],
      params: [
        { name: 'maxItems', type: 'number', description: 'Max items', defaultValue: 50 },
      ],
    });

    const model = registry.applyTemplate('withDefaults', {});
    const plan = model.toQueryPlan();
    const condition = plan.where!.conditions[0] as { value: unknown };
    expect(condition.value).toBe(50);
  });
});
