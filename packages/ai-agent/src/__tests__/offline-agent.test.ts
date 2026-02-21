import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createOfflineAgent, OfflineAgent } from '../index.js';
import type {
  OfflineAgentConfig,
  CollectionContext,
  AgentQuery,
  OfflineAgentResult,
} from '../index.js';
import type { LLMProvider, LLMResponse, ConversationMessage } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAdapter(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock-local',
    async complete(): Promise<LLMResponse> {
      const content = responses[callIndex % responses.length]!;
      callIndex++;
      return { content, finishReason: 'stop' };
    },
  };
}

const todoCollection: CollectionContext = {
  name: 'todos',
  description: 'task list',
  fields: [
    { name: 'title', type: 'string' },
    { name: 'completed', type: 'boolean' },
  ],
};

const usersCollection: CollectionContext = {
  name: 'users',
  description: 'registered users',
  fields: [
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string' },
  ],
};

function defaultConfig(responses: string[]): OfflineAgentConfig {
  return {
    adapter: createMockAdapter(responses),
    collections: [todoCollection, usersCollection],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OfflineAgent', () => {
  describe('ask — basic question and answer with steps', () => {
    it('returns an answer, steps, and confidence', async () => {
      const agent = createOfflineAgent(
        defaultConfig([
          'THINK: The user wants incomplete todos.\nQUERY: SELECT * FROM todos WHERE completed = false\nANSWER: There are 2 incomplete todos. CONFIDENCE:0.9',
        ]),
      );

      const result = await agent.ask({ question: 'How many incomplete todos?' });

      expect(result.answer).toContain('2 incomplete todos');
      expect(result.confidence).toBe(0.9);
      expect(result.steps.length).toBeGreaterThanOrEqual(3); // think(agent) + query(agent) + parsed steps
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.documentsUsed).toBeGreaterThan(0);

      const types = result.steps.map((s) => s.type);
      expect(types).toContain('think');
      expect(types).toContain('query');
      expect(types).toContain('answer');
    });
  });

  describe('collection detection from question', () => {
    it('detects the todos collection when mentioned in the question', async () => {
      const completeFn = vi.fn(async (): Promise<LLMResponse> => ({
        content: 'THINK: Looking at todos.\nANSWER: Found 3 todos. CONFIDENCE:0.85',
        finishReason: 'stop',
      }));
      const adapter: LLMProvider = { name: 'mock', complete: completeFn };
      const agent = createOfflineAgent({ adapter, collections: [todoCollection, usersCollection] });

      await agent.ask({ question: 'Show me all todos' });

      // The user message should mention the todos collection context
      const call = completeFn.mock.calls[0]!;
      const messages = call[0] as ConversationMessage[];
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('todos');
    });

    it('uses explicit collection when provided', async () => {
      const completeFn = vi.fn(async (): Promise<LLMResponse> => ({
        content: 'ANSWER: 5 users found. CONFIDENCE:0.95',
        finishReason: 'stop',
      }));
      const adapter: LLMProvider = { name: 'mock', complete: completeFn };
      const agent = createOfflineAgent({ adapter, collections: [todoCollection, usersCollection] });

      const result = await agent.ask({ question: 'How many?', collection: 'users' });

      expect(result.answer).toContain('5 users');
      const call = completeFn.mock.calls[0]!;
      const messages = call[0] as ConversationMessage[];
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg?.content).toContain('users');
    });
  });

  describe('multi-step reasoning', () => {
    it('captures multiple reasoning steps from the LLM', async () => {
      const agent = createOfflineAgent(
        defaultConfig([
          [
            'THINK: I need to find overdue items first.',
            'QUERY: SELECT * FROM todos WHERE completed = false AND due < NOW()',
            'THINK: Now I should count them.',
            'ANSWER: There are 2 overdue tasks. CONFIDENCE:0.8',
          ].join('\n'),
        ]),
      );

      const result = await agent.ask({ question: 'Any overdue tasks?' });

      const thinkSteps = result.steps.filter((s) => s.type === 'think');
      expect(thinkSteps.length).toBeGreaterThanOrEqual(2);
      expect(result.confidence).toBe(0.8);
    });
  });

  describe('stats tracking', () => {
    it('tracks queries and computes averages', async () => {
      const agent = createOfflineAgent(
        defaultConfig([
          'ANSWER: Result 1. CONFIDENCE:0.7',
          'ANSWER: Result 2. CONFIDENCE:0.8',
        ]),
      );

      expect(agent.getStats().totalQueries).toBe(0);

      await agent.ask({ question: 'First question' });
      await agent.ask({ question: 'Second question' });

      const stats = agent.getStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.avgResponseTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.avgStepsPerQuery).toBeGreaterThan(0);
    });
  });

  describe('clearHistory', () => {
    it('resets conversation state and stats', async () => {
      const agent = createOfflineAgent(
        defaultConfig(['ANSWER: done. CONFIDENCE:0.9']),
      );

      await agent.ask({ question: 'Something' });
      expect(agent.getStats().totalQueries).toBe(1);

      agent.clearHistory();

      const stats = agent.getStats();
      expect(stats.totalQueries).toBe(0);
      expect(stats.avgResponseTimeMs).toBe(0);
      expect(stats.avgStepsPerQuery).toBe(0);
    });
  });

  describe('getCollections / updateCollections', () => {
    it('lists and updates collections', () => {
      const agent = createOfflineAgent(defaultConfig(['ANSWER: ok']));

      expect(agent.getCollections()).toHaveLength(2);
      expect(agent.getCollections().map((c) => c.name)).toEqual(['todos', 'users']);

      agent.updateCollections([usersCollection]);
      expect(agent.getCollections()).toHaveLength(1);
      expect(agent.getCollections()[0]!.name).toBe('users');
    });
  });

  describe('error handling', () => {
    it('throws a descriptive error when the LLM adapter fails', async () => {
      const adapter: LLMProvider = {
        name: 'failing',
        async complete(): Promise<LLMResponse> {
          throw new Error('Model not loaded');
        },
      };
      const agent = createOfflineAgent({ adapter, collections: [todoCollection] });

      await expect(agent.ask({ question: 'hello' })).rejects.toThrow(
        'LLM completion failed: Model not loaded',
      );
    });

    it('does not increment stats on failure', async () => {
      const adapter: LLMProvider = {
        name: 'failing',
        async complete(): Promise<LLMResponse> {
          throw new Error('boom');
        },
      };
      const agent = createOfflineAgent({ adapter, collections: [todoCollection] });

      try {
        await agent.ask({ question: 'fail' });
      } catch {
        // expected
      }

      expect(agent.getStats().totalQueries).toBe(0);
    });
  });
});
