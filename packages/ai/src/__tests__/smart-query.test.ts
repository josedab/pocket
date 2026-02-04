import { describe, it, expect, vi } from 'vitest';
import { SmartQueryEngine, type CollectionSchema, type GeneratedQuery } from '../smart-query.js';
import type { LLMAdapter, Message } from '../types.js';

function createMockAdapter(responses: string[]): LLMAdapter {
  let callIndex = 0;
  return {
    complete: vi.fn(async (_messages: Message[], _options?: Record<string, unknown>) => {
      const content = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return { content };
    }),
    stream: vi.fn(),
    isAvailable: vi.fn(() => true),
    provider: 'custom' as const,
  } as unknown as LLMAdapter;
}

const TEST_SCHEMAS: CollectionSchema[] = [
  {
    name: 'todos',
    description: 'Task management collection',
    fields: [
      { name: 'title', type: 'string', description: 'Task title' },
      { name: 'completed', type: 'boolean', description: 'Whether the task is done' },
      { name: 'priority', type: 'string', enum: ['low', 'medium', 'high'] },
      { name: 'assignee', type: 'string', description: 'Assigned user' },
      { name: 'dueDate', type: 'date', description: 'Due date' },
      { name: 'tags', type: 'array', description: 'Task tags' },
    ],
  },
  {
    name: 'users',
    description: 'User accounts',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
      { name: 'role', type: 'string', enum: ['admin', 'user', 'viewer'] },
      { name: 'active', type: 'boolean' },
    ],
  },
];

describe('SmartQueryEngine', () => {
  describe('generateQuery', () => {
    it('should generate a query from natural language', async () => {
      const mockResponse = JSON.stringify({
        collection: 'todos',
        filter: { completed: { $eq: false }, priority: { $eq: 'high' } },
        sort: { dueDate: 'asc' },
        limit: null,
        skip: null,
        explanation: 'Find incomplete high-priority tasks sorted by due date',
        confidence: 0.95,
      });

      const adapter = createMockAdapter([mockResponse]);
      const engine = new SmartQueryEngine({
        adapter,
        schemas: TEST_SCHEMAS,
        cacheEnabled: false,
      });

      const result = await engine.generateQuery('show me incomplete high priority tasks');

      expect(result.collection).toBe('todos');
      expect(result.filter).toHaveProperty('completed');
      expect(result.filter).toHaveProperty('priority');
      expect(result.sort).toEqual({ dueDate: 'asc' });
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.naturalLanguage).toBe('show me incomplete high priority tasks');
    });

    it('should use cache for repeated queries', async () => {
      const mockResponse = JSON.stringify({
        collection: 'todos',
        filter: { completed: false },
        explanation: 'Find incomplete tasks',
        confidence: 0.9,
      });

      const adapter = createMockAdapter([mockResponse]);
      const engine = new SmartQueryEngine({
        adapter,
        schemas: TEST_SCHEMAS,
        cacheEnabled: true,
      });

      await engine.generateQuery('show incomplete tasks');
      await engine.generateQuery('show incomplete tasks');

      expect(adapter.complete).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const badResponse = 'Not valid JSON at all';
      const goodResponse = JSON.stringify({
        collection: 'todos',
        filter: {},
        explanation: 'All todos',
        confidence: 0.8,
      });

      const adapter = createMockAdapter([badResponse, goodResponse]);
      const engine = new SmartQueryEngine({
        adapter,
        schemas: TEST_SCHEMAS,
        maxRetries: 1,
        cacheEnabled: false,
      });

      const result = await engine.generateQuery('show all todos');
      expect(result.collection).toBe('todos');
    });

    it('should throw after max retries exceeded', async () => {
      const adapter = createMockAdapter(['not json', 'still not json', 'nope']);
      const engine = new SmartQueryEngine({
        adapter,
        schemas: TEST_SCHEMAS,
        maxRetries: 1,
        cacheEnabled: false,
      });

      await expect(engine.generateQuery('impossible query')).rejects.toThrow(
        /Failed to generate query/
      );
    });
  });

  describe('validateQuery', () => {
    it('should validate correct query', () => {
      const adapter = createMockAdapter([]);
      const engine = new SmartQueryEngine({ adapter, schemas: TEST_SCHEMAS });

      const result = engine.validateQuery({
        collection: 'todos',
        filter: { completed: false, priority: 'high' },
        sort: { dueDate: 'asc' },
        explanation: 'test',
        confidence: 1,
        naturalLanguage: 'test',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject unknown collection', () => {
      const adapter = createMockAdapter([]);
      const engine = new SmartQueryEngine({ adapter, schemas: TEST_SCHEMAS });

      const result = engine.validateQuery({
        collection: 'nonexistent',
        filter: {},
        explanation: 'test',
        confidence: 1,
        naturalLanguage: 'test',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown collection: nonexistent');
    });

    it('should reject unknown filter fields', () => {
      const adapter = createMockAdapter([]);
      const engine = new SmartQueryEngine({ adapter, schemas: TEST_SCHEMAS });

      const result = engine.validateQuery({
        collection: 'todos',
        filter: { nonexistent: true },
        explanation: 'test',
        confidence: 1,
        naturalLanguage: 'test',
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('nonexistent');
    });

    it('should allow internal fields like _id', () => {
      const adapter = createMockAdapter([]);
      const engine = new SmartQueryEngine({ adapter, schemas: TEST_SCHEMAS });

      const result = engine.validateQuery({
        collection: 'todos',
        filter: { _id: 'test-id' },
        explanation: 'test',
        confidence: 1,
        naturalLanguage: 'test',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('suggestQueries', () => {
    it('should return query suggestions', async () => {
      const mockSuggestions = JSON.stringify([
        {
          text: 'Show all incomplete tasks',
          description: 'Lists all todo items not yet completed',
          relevance: 0.9,
        },
        {
          text: 'Find high priority items',
          description: 'Tasks marked as high priority',
          relevance: 0.8,
        },
      ]);

      const adapter = createMockAdapter([mockSuggestions]);
      const engine = new SmartQueryEngine({ adapter, schemas: TEST_SCHEMAS });

      const suggestions = await engine.suggestQueries();
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0]!.relevance).toBeGreaterThanOrEqual(suggestions[1]!.relevance);
    });

    it('should return empty array on failure', async () => {
      const adapter = createMockAdapter(['not json']);
      const engine = new SmartQueryEngine({ adapter, schemas: TEST_SCHEMAS });

      const suggestions = await engine.suggestQueries();
      expect(suggestions).toEqual([]);
    });
  });

  describe('cache management', () => {
    it('should respect max cache size', async () => {
      const adapter = createMockAdapter(
        Array(5)
          .fill(null)
          .map((_, i) =>
            JSON.stringify({
              collection: 'todos',
              filter: {},
              explanation: `query ${i}`,
              confidence: 0.9,
            })
          )
      );
      const engine = new SmartQueryEngine({
        adapter,
        schemas: TEST_SCHEMAS,
        cacheEnabled: true,
        maxCacheSize: 3,
      });

      await engine.generateQuery('query 1');
      await engine.generateQuery('query 2');
      await engine.generateQuery('query 3');
      await engine.generateQuery('query 4');

      const stats = engine.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(3);
    });

    it('should clear cache', async () => {
      const adapter = createMockAdapter([
        JSON.stringify({
          collection: 'todos',
          filter: {},
          explanation: 'test',
          confidence: 0.9,
        }),
      ]);
      const engine = new SmartQueryEngine({
        adapter,
        schemas: TEST_SCHEMAS,
        cacheEnabled: true,
      });

      await engine.generateQuery('test query');
      expect(engine.getCacheStats().size).toBe(1);

      engine.clearCache();
      expect(engine.getCacheStats().size).toBe(0);
    });
  });
});
