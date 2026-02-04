import { describe, it, expect } from 'vitest';
import { QuerySuggestionEngine, createQuerySuggestionEngine } from '../suggestions.js';
import type { SchemaMap } from '../suggestions.js';
import { IndexAdvisor, createIndexAdvisor } from '../index-advisor.js';
import type { AdvisorSchemaMap } from '../index-advisor.js';

const TEST_SCHEMAS: SchemaMap = {
  todos: [
    { name: 'title', type: 'string', description: 'Task title' },
    { name: 'completed', type: 'boolean', description: 'Whether the task is done' },
    { name: 'priority', type: 'number', description: 'Priority level' },
    { name: 'dueDate', type: 'date', description: 'Due date' },
    { name: 'tags', type: 'array', description: 'Task tags' },
  ],
  users: [
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string', required: true },
    { name: 'age', type: 'number' },
    { name: 'active', type: 'boolean' },
  ],
};

describe('QuerySuggestionEngine', () => {
  describe('suggest', () => {
    it('should suggest fields matching partial input', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const suggestions = engine.suggest('pri');

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.text === 'priority')).toBe(true);
    });

    it('should suggest string operators for string fields', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const suggestions = engine.suggest('title');

      const titleSuggestion = suggestions.find((s) => s.text === 'title');
      expect(titleSuggestion).toBeDefined();
      expect(titleSuggestion!.operator).toBe('$eq');
    });

    it('should suggest numeric operators for number fields', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const suggestions = engine.suggest('priority');

      const priSuggestion = suggestions.find(
        (s) => s.text === 'priority' && s.collection === 'todos'
      );
      expect(priSuggestion).toBeDefined();
      // Number fields use $eq as primary operator from OPERATORS_BY_TYPE
      expect(priSuggestion!.operator).toBe('$eq');
    });

    it('should return all fields when partial is empty', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const suggestions = engine.suggest('');

      // Should include fields from both collections
      const fieldCount =
        TEST_SCHEMAS['todos']!.length + TEST_SCHEMAS['users']!.length;
      expect(suggestions).toHaveLength(fieldCount);
    });

    it('should rank prefix matches higher', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const suggestions = engine.suggest('t');

      const titleSuggestion = suggestions.find((s) => s.text === 'title');
      const completedSuggestion = suggestions.find((s) => s.text === 'completed');
      // 'title' starts with 't', 'completed' does not
      if (titleSuggestion && completedSuggestion) {
        expect(titleSuggestion.relevance).toBeGreaterThan(completedSuggestion.relevance);
      }
    });
  });

  describe('suggestFilters', () => {
    it('should return filter suggestions with compatible operators', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const filters = engine.suggestFilters('todos');

      expect(filters.length).toBe(TEST_SCHEMAS['todos']!.length);

      const titleFilter = filters.find((f) => f.field === 'title');
      expect(titleFilter).toBeDefined();
      expect(titleFilter!.operators).toContain('$contains');
      expect(titleFilter!.type).toBe('string');

      const priorityFilter = filters.find((f) => f.field === 'priority');
      expect(priorityFilter).toBeDefined();
      expect(priorityFilter!.operators).toContain('$gt');
      expect(priorityFilter!.operators).toContain('$lt');
      expect(priorityFilter!.type).toBe('number');
    });

    it('should return boolean operators for boolean fields', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const filters = engine.suggestFilters('todos');

      const completedFilter = filters.find((f) => f.field === 'completed');
      expect(completedFilter).toBeDefined();
      expect(completedFilter!.operators).toEqual(['$eq', '$ne']);
    });

    it('should return empty for unknown collection', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      expect(engine.suggestFilters('nonexistent')).toEqual([]);
    });
  });

  describe('suggestSorts', () => {
    it('should suggest sortable fields', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const sorts = engine.suggestSorts('todos');

      // object and array fields are excluded
      expect(sorts.length).toBe(
        TEST_SCHEMAS['todos']!.filter((f) => f.type !== 'object' && f.type !== 'array').length
      );
    });

    it('should default dates to descending', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const sorts = engine.suggestSorts('todos');

      const dateSort = sorts.find((s) => s.field === 'dueDate');
      expect(dateSort).toBeDefined();
      expect(dateSort!.direction).toBe('desc');
    });

    it('should default strings to ascending', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const sorts = engine.suggestSorts('todos');

      const titleSort = sorts.find((s) => s.field === 'title');
      expect(titleSort).toBeDefined();
      expect(titleSort!.direction).toBe('asc');
    });
  });

  describe('query frequency tracking', () => {
    it('should increase relevance for frequently queried fields', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);

      const before = engine.suggestFilters('todos');
      const completedBefore = before.find((f) => f.field === 'completed')!.relevance;

      // Record multiple queries using 'completed'
      engine.recordQuery('todos', { completed: false });
      engine.recordQuery('todos', { completed: true });
      engine.recordQuery('todos', { completed: false });

      const after = engine.suggestFilters('todos');
      const completedAfter = after.find((f) => f.field === 'completed')!.relevance;

      expect(completedAfter).toBeGreaterThan(completedBefore);
    });

    it('should track query count', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);

      engine.recordQuery('todos', { completed: false });
      engine.recordQuery('todos', { priority: { $gt: 5 } });

      expect(engine.getQueryCount()).toBe(2);
    });

    it('should track field frequency per collection', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);

      engine.recordQuery('todos', { completed: false });
      engine.recordQuery('todos', { completed: true });
      engine.recordQuery('todos', { title: 'test' });

      const freq = engine.getFieldFrequency('todos');
      expect(freq.get('completed')).toBe(2);
      expect(freq.get('title')).toBe(1);
    });
  });

  describe('factory function', () => {
    it('should create engine via factory', () => {
      const engine = createQuerySuggestionEngine(TEST_SCHEMAS);
      expect(engine).toBeInstanceOf(QuerySuggestionEngine);
      expect(engine.suggest('title').length).toBeGreaterThan(0);
    });
  });

  describe('RxJS observable', () => {
    it('should emit suggestions via observable', () => {
      const engine = new QuerySuggestionEngine(TEST_SCHEMAS);
      const emitted: unknown[] = [];

      const sub = engine.suggestionsObservable.subscribe((v) => emitted.push(v));

      engine.suggest('title');

      sub.unsubscribe();
      // Initial empty + one suggest call
      expect(emitted.length).toBe(2);
    });
  });
});

describe('IndexAdvisor', () => {
  const ADVISOR_SCHEMAS: AdvisorSchemaMap = {
    todos: [
      { name: 'title', type: 'string' },
      { name: 'completed', type: 'boolean' },
      { name: 'priority', type: 'number' },
      { name: 'dueDate', type: 'date' },
    ],
    users: [
      { name: 'name', type: 'string' },
      { name: 'email', type: 'string' },
      { name: 'age', type: 'number' },
    ],
  };

  describe('analyzeQuery', () => {
    it('should recommend index for filter fields', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      const rec = advisor.analyzeQuery('todos', {
        filter: { completed: false },
      });

      expect(rec.collection).toBe('todos');
      expect(rec.fields).toContain('completed');
      expect(rec.type).toBe('single');
      expect(rec.reason).toContain('completed');
    });

    it('should recommend compound index for multi-field queries', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      const rec = advisor.analyzeQuery('todos', {
        filter: { completed: false, priority: { $gt: 5 } },
      });

      expect(rec.type).toBe('compound');
      expect(rec.fields).toContain('completed');
      expect(rec.fields).toContain('priority');
    });

    it('should include sort fields in index recommendation', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      const rec = advisor.analyzeQuery('todos', {
        filter: { completed: false },
        sort: { dueDate: 'asc' },
      });

      expect(rec.fields).toContain('completed');
      expect(rec.fields).toContain('dueDate');
      expect(rec.type).toBe('compound');
    });

    it('should reflect affected queries count', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      advisor.recordQueryExecution('todos', { completed: false }, 30);
      advisor.recordQueryExecution('todos', { completed: true }, 25);

      const rec = advisor.analyzeQuery('todos', {
        filter: { completed: false },
      });

      expect(rec.affectedQueries).toBe(2);
    });
  });

  describe('analyzePatterns', () => {
    it('should group and recommend indexes by pattern', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      advisor.recordQueryExecution('todos', { completed: false }, 40);
      advisor.recordQueryExecution('todos', { completed: true }, 35);
      advisor.recordQueryExecution('todos', { completed: false }, 50);
      advisor.recordQueryExecution('users', { email: 'test@test.com' }, 20);

      const recs = advisor.analyzePatterns();

      expect(recs.length).toBeGreaterThanOrEqual(2);

      const todosRec = recs.find(
        (r) => r.collection === 'todos' && r.fields.includes('completed')
      );
      expect(todosRec).toBeDefined();
      expect(todosRec!.affectedQueries).toBe(3);

      const usersRec = recs.find(
        (r) => r.collection === 'users' && r.fields.includes('email')
      );
      expect(usersRec).toBeDefined();
    });

    it('should sort recommendations by impact', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      // Many slow queries on completed
      for (let i = 0; i < 10; i++) {
        advisor.recordQueryExecution('todos', { completed: false }, 80);
      }
      // Few fast queries on name
      advisor.recordQueryExecution('users', { name: 'Alice' }, 5);

      const recs = advisor.analyzePatterns();

      expect(recs.length).toBeGreaterThanOrEqual(2);
      expect(recs[0]!.impact).toBeGreaterThanOrEqual(recs[1]!.impact);
    });
  });

  describe('estimateImprovement', () => {
    it('should estimate speedup based on execution history', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      advisor.recordQueryExecution('todos', { completed: false }, 100);
      advisor.recordQueryExecution('todos', { completed: true }, 100);
      advisor.recordQueryExecution('todos', { completed: false }, 100);

      const rec = advisor.analyzeQuery('todos', {
        filter: { completed: false },
      });
      const estimate = advisor.estimateImprovement(rec);

      expect(estimate.currentAvgTimeMs).toBe(100);
      expect(estimate.estimatedTimeMs).toBeLessThan(100);
      expect(estimate.estimatedSpeedup).toBeGreaterThan(1);
      expect(estimate.confidence).toBeGreaterThan(0);
    });

    it('should return no improvement when no data exists', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      const estimate = advisor.estimateImprovement({
        collection: 'todos',
        fields: ['completed'],
        type: 'single',
        reason: 'test',
        impact: 0.5,
        affectedQueries: 0,
      });

      expect(estimate.estimatedSpeedup).toBe(1);
      expect(estimate.confidence).toBe(0);
    });

    it('should have higher speedup for compound indexes', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      for (let i = 0; i < 5; i++) {
        advisor.recordQueryExecution(
          'todos',
          { completed: false, priority: 5 },
          100
        );
      }

      const compoundRec: Parameters<typeof advisor.estimateImprovement>[0] = {
        collection: 'todos',
        fields: ['completed', 'priority'],
        type: 'compound',
        reason: 'test',
        impact: 0.8,
        affectedQueries: 5,
      };

      const singleRec: Parameters<typeof advisor.estimateImprovement>[0] = {
        collection: 'todos',
        fields: ['completed'],
        type: 'single',
        reason: 'test',
        impact: 0.5,
        affectedQueries: 5,
      };

      const compoundEstimate = advisor.estimateImprovement(compoundRec);
      const singleEstimate = advisor.estimateImprovement(singleRec);

      expect(compoundEstimate.estimatedSpeedup).toBeGreaterThan(
        singleEstimate.estimatedSpeedup
      );
    });
  });

  describe('getTopRecommendations', () => {
    it('should return limited recommendations', () => {
      const advisor = new IndexAdvisor(ADVISOR_SCHEMAS);

      advisor.recordQueryExecution('todos', { completed: false }, 40);
      advisor.recordQueryExecution('todos', { priority: 1 }, 30);
      advisor.recordQueryExecution('users', { email: 'a@b.com' }, 20);

      const top = advisor.getTopRecommendations(2);
      expect(top.length).toBeLessThanOrEqual(2);
    });
  });

  describe('factory function', () => {
    it('should create advisor via factory', () => {
      const advisor = createIndexAdvisor(ADVISOR_SCHEMAS);
      expect(advisor).toBeInstanceOf(IndexAdvisor);

      advisor.recordQueryExecution('todos', { completed: false }, 50);
      expect(advisor.getExecutionCount()).toBe(1);
    });
  });
});
