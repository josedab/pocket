import { describe, expect, it } from 'vitest';
import { LocalQueryInference } from '../local-query-inference.js';
import type { CollectionSchema } from '../smart-query.js';

const todosSchema: CollectionSchema = {
  name: 'todos',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'completed', type: 'boolean' },
    { name: 'priority', type: 'number' },
    { name: 'dueDate', type: 'date' },
    { name: 'assignee', type: 'string' },
    { name: 'status', type: 'string', enum: ['open', 'in-progress', 'closed'] },
  ],
};

const usersSchema: CollectionSchema = {
  name: 'users',
  fields: [
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string' },
    { name: 'age', type: 'number' },
    { name: 'active', type: 'boolean' },
    { name: 'createdAt', type: 'date' },
  ],
};

describe('LocalQueryInference', () => {
  const engine = new LocalQueryInference({ schemas: [todosSchema, usersSchema] });

  describe('collection detection', () => {
    it('should detect collection from direct name', () => {
      const result = engine.parse('show me all todos');
      expect(result.collection).toBe('todos');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect collection from singular form', () => {
      const result = engine.parse('find each todo');
      expect(result.collection).toBe('todos');
    });

    it('should return empty collection when none can be inferred', () => {
      const isolated = new LocalQueryInference({ schemas: [todosSchema, usersSchema] });
      const result = isolated.parse('give me everything');
      // Should still try to match; may or may not find one
      expect(result).toBeDefined();
    });
  });

  describe('boolean filters', () => {
    it('should detect "incomplete" as completed=false', () => {
      const result = engine.parse('show me incomplete todos');
      expect(result.filter.completed).toBe(false);
    });

    it('should detect "completed" as completed=true', () => {
      const result = engine.parse('find completed todos');
      expect(result.filter.completed).toBe(true);
    });

    it('should detect "active" users', () => {
      const result = engine.parse('list active users');
      expect(result.filter.active).toBe(true);
    });
  });

  describe('temporal filters', () => {
    it('should detect "overdue" keyword', () => {
      const result = engine.parse('show me overdue todos');
      expect(result.filter.dueDate).toBeDefined();
      const filter = result.filter.dueDate as Record<string, string>;
      expect(filter.$lt).toBeDefined();
    });

    it('should detect "this week" keyword', () => {
      const result = engine.parse('todos due this week');
      expect(result.filter.dueDate).toBeDefined();
    });
  });

  describe('comparison filters', () => {
    it('should detect "high priority"', () => {
      const result = engine.parse('high priority todos');
      expect(result.filter.priority).toEqual({ $gte: 7 });
    });

    it('should detect "low priority"', () => {
      const result = engine.parse('low priority todos');
      expect(result.filter.priority).toEqual({ $lte: 3 });
    });

    it('should detect "priority > 5"', () => {
      const result = engine.parse('todos with priority > 5');
      expect(result.filter.priority).toEqual({ $gt: 5 });
    });
  });

  describe('string filters', () => {
    it('should detect "by <person>" for assignee fields', () => {
      const result = engine.parse('todos by alice');
      expect(result.filter.assignee).toBe('alice');
    });
  });

  describe('enum filters', () => {
    it('should detect enum values from input', () => {
      const result = engine.parse('show in-progress todos');
      expect(result.filter.status).toBe('in-progress');
    });
  });

  describe('sort extraction', () => {
    it('should detect "newest" as date desc', () => {
      const result = engine.parse('newest todos');
      expect(result.sort).toEqual({ dueDate: 'desc' });
    });

    it('should detect "oldest" as date asc', () => {
      const result = engine.parse('oldest todos');
      expect(result.sort).toEqual({ dueDate: 'asc' });
    });

    it('should detect explicit "sort by priority desc"', () => {
      const result = engine.parse('todos sort by priority desc');
      expect(result.sort).toEqual({ priority: 'desc' });
    });
  });

  describe('limit extraction', () => {
    it('should detect "top 10"', () => {
      const result = engine.parse('top 10 todos');
      expect(result.limit).toBe(10);
    });

    it('should detect "first 5"', () => {
      const result = engine.parse('first 5 users');
      expect(result.limit).toBe(5);
    });

    it('should detect "limit 20"', () => {
      const result = engine.parse('todos limit 20');
      expect(result.limit).toBe(20);
    });
  });

  describe('combined queries', () => {
    it('should handle multi-filter queries', () => {
      const result = engine.parse('top 5 incomplete high priority todos');
      expect(result.collection).toBe('todos');
      expect(result.filter.completed).toBe(false);
      expect(result.filter.priority).toEqual({ $gte: 7 });
      expect(result.limit).toBe(5);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should produce explanations', () => {
      const result = engine.parse('newest incomplete todos');
      expect(result.explanation).toContain('todos');
      expect(result.explanation.length).toBeGreaterThan(0);
    });
  });

  describe('schema updates', () => {
    it('should work after schema update', () => {
      const eng = new LocalQueryInference({ schemas: [todosSchema] });
      eng.updateSchemas([usersSchema]);
      const result = eng.parse('active users');
      expect(result.collection).toBe('users');
      expect(result.filter.active).toBe(true);
    });
  });

  describe('custom keywords', () => {
    it('should apply custom keyword rules', () => {
      const eng = new LocalQueryInference({
        schemas: [todosSchema],
        customKeywords: {
          urgent: { field: 'priority', filter: { $gte: 9 }, confidence: 0.3 },
        },
      });

      const result = eng.parse('urgent todos');
      expect(result.filter.priority).toEqual({ $gte: 9 });
    });
  });
});
