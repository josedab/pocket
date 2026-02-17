import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryCopilot, createQueryCopilot, type QueryCopilotConfig } from '../query-copilot.js';
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

function makeConfig(adapterResponses: string[]): QueryCopilotConfig {
  return {
    adapter: createMockAdapter(adapterResponses),
    collections: {
      todos: {
        description: 'Task management',
        fields: [
          { name: 'title', type: 'string', description: 'Task title' },
          { name: 'completed', type: 'boolean' },
          { name: 'dueDate', type: 'date' },
          { name: 'assignee', type: 'string' },
        ],
      },
      notes: {
        fields: [
          { name: 'content', type: 'string' },
          { name: 'tags', type: 'array' },
        ],
      },
    },
  };
}

describe('QueryCopilot', () => {
  describe('ask', () => {
    it('should generate a valid query from natural language', async () => {
      const response = JSON.stringify({
        collection: 'todos',
        filter: { completed: { $eq: false } },
        sort: { dueDate: 'asc' },
        limit: 10,
        explanation: 'Find incomplete todos sorted by due date',
        confidence: 0.9,
      });

      const copilot = createQueryCopilot(makeConfig([response]));
      const result = await copilot.ask('show me incomplete todos sorted by due date');

      expect(result.isValid).toBe(true);
      expect(result.query.collection).toBe('todos');
      expect(result.confidence).toBe(0.9);
      expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.naturalLanguage).toBe('show me incomplete todos sorted by due date');
    });

    it('should detect invalid fields in generated query', async () => {
      const response = JSON.stringify({
        collection: 'todos',
        filter: { nonexistent: { $eq: true } },
        explanation: 'Bad query',
        confidence: 0.3,
      });

      // The SmartQueryEngine will try and fail validation, then retry.
      // After maxRetries, it throws. Copilot wraps this.
      const copilot = createQueryCopilot(makeConfig([response, response, response]));

      await expect(copilot.ask('something invalid')).rejects.toThrow();
    });

    it('should track history', async () => {
      const response = JSON.stringify({
        collection: 'todos',
        filter: {},
        explanation: 'Get all todos',
        confidence: 0.95,
      });

      const copilot = createQueryCopilot(makeConfig([response, response]));
      await copilot.ask('get all todos');
      await copilot.ask('get all todos again');

      const history = copilot.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.question).toBe('get all todos');
    });

    it('should clear history', async () => {
      const response = JSON.stringify({
        collection: 'todos',
        filter: {},
        explanation: 'All',
        confidence: 0.9,
      });

      const copilot = createQueryCopilot(makeConfig([response]));
      await copilot.ask('get all');
      copilot.clearHistory();

      expect(copilot.getHistory()).toHaveLength(0);
    });
  });

  describe('validate', () => {
    it('should validate a correct query', () => {
      const copilot = createQueryCopilot(makeConfig([]));

      const result = copilot.validate({
        collection: 'todos',
        filter: { completed: false },
        explanation: '',
        confidence: 1,
        naturalLanguage: '',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject unknown collection', () => {
      const copilot = createQueryCopilot(makeConfig([]));

      const result = copilot.validate({
        collection: 'unknown',
        filter: {},
        explanation: '',
        confidence: 1,
        naturalLanguage: '',
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown collection');
    });
  });

  describe('updateCollections', () => {
    it('should accept new collection schemas', () => {
      const copilot = createQueryCopilot(makeConfig([]));

      copilot.updateCollections({
        projects: {
          fields: [{ name: 'name', type: 'string' }],
        },
      });

      const result = copilot.validate({
        collection: 'projects',
        filter: { name: 'test' },
        explanation: '',
        confidence: 1,
        naturalLanguage: '',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const copilot = createQueryCopilot(makeConfig([]));
      const stats = copilot.getCacheStats();

      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBeGreaterThan(0);
    });
  });

  describe('createUseNaturalQueryHook', () => {
    it('should be importable', async () => {
      const { createUseNaturalQueryHook } = await import('../query-copilot.js');
      expect(typeof createUseNaturalQueryHook).toBe('function');
    });
  });
});
