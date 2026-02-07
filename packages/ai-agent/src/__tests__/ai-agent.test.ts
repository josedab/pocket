import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAgent,
  createDatabaseTools,
  createConversationMemory,
  createToolRegistry,
} from '../index.js';
import type {
  LLMProvider,
  LLMResponse,
  ConversationMessage,
  Tool,
  AgentContext,
  DatabaseAdapter,
} from '../index.js';

function createMockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      const response = responses[callIndex % responses.length]!;
      callIndex++;
      return response;
    },
  };
}

function createMockDatabase(): DatabaseAdapter {
  const data: Record<string, Record<string, unknown>[]> = {
    todos: [
      { _id: '1', title: 'Buy milk', completed: false },
      { _id: '2', title: 'Write code', completed: true },
      { _id: '3', title: 'Read book', completed: false },
    ],
  };

  return {
    getCollectionNames: () => Object.keys(data),
    async query(collection, filter) {
      const docs = data[collection] || [];
      if (!filter) return docs;
      return docs.filter((d) =>
        Object.entries(filter).every(([k, v]) => d[k] === v),
      );
    },
    async get(collection, id) {
      return (data[collection] || []).find((d) => d['_id'] === id) ?? null;
    },
    async insert(collection, doc) {
      if (!data[collection]) data[collection] = [];
      data[collection].push(doc);
      return doc;
    },
    async update(collection, id, changes) {
      const docs = data[collection] || [];
      const idx = docs.findIndex((d) => d['_id'] === id);
      if (idx >= 0) docs[idx] = { ...docs[idx], ...changes };
      return docs[idx] ?? null;
    },
    async count(collection, filter) {
      const docs = data[collection] || [];
      if (!filter) return docs.length;
      return docs.filter((d) =>
        Object.entries(filter).every(([k, v]) => d[k] === v),
      ).length;
    },
    async delete(collection, id) {
      const docs = data[collection] || [];
      const idx = docs.findIndex((d) => d['_id'] === id);
      if (idx >= 0) docs.splice(idx, 1);
    },
  };
}

describe('@pocket/ai-agent', () => {
  describe('createAgent', () => {
    it('should create agent and run simple completion', async () => {
      const provider = createMockProvider([
        { content: 'There are 3 todos total.', finishReason: 'stop' },
      ]);

      const agent = createAgent({ provider });
      const response = await agent.run('How many todos?');

      expect(response.content).toBe('There are 3 todos total.');
      expect(response.steps).toHaveLength(1);
      expect(response.iterationCount).toBe(1);
      expect(response.toolCallCount).toBe(0);
    });

    it('should handle tool calling loop', async () => {
      const db = createMockDatabase();
      const tools = createDatabaseTools(db);

      const provider = createMockProvider([
        {
          content: 'Let me count the todos.',
          finishReason: 'tool_calls',
          toolCalls: [
            { id: 'tc-1', name: 'count_documents', arguments: { collection: 'todos' } },
          ],
        },
        { content: 'There are 3 todos in the database.', finishReason: 'stop' },
      ]);

      const agent = createAgent({ provider, tools: [...tools] });
      const response = await agent.run('Count my todos');

      expect(response.content).toBe('There are 3 todos in the database.');
      expect(response.toolCallCount).toBe(1);
      expect(response.iterationCount).toBe(2);
      expect(response.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('should respect maxIterations', async () => {
      const provider = createMockProvider([
        {
          content: '',
          finishReason: 'tool_calls',
          toolCalls: [
            { id: 'tc-1', name: 'unknown_tool', arguments: {} },
          ],
        },
      ]);

      const agent = createAgent({ provider, maxIterations: 2 });
      const response = await agent.run('Loop forever');

      expect(response.iterationCount).toBe(2);
      expect(response.content).toContain('maximum iterations');
    });

    it('should throw when running after destroy', async () => {
      const provider = createMockProvider([
        { content: 'ok', finishReason: 'stop' },
      ]);

      const agent = createAgent({ provider });
      agent.destroy();

      await expect(agent.run('test')).rejects.toThrow('destroyed');
    });

    it('should maintain conversation history', async () => {
      const provider = createMockProvider([
        { content: 'Response 1', finishReason: 'stop' },
        { content: 'Response 2', finishReason: 'stop' },
      ]);

      const agent = createAgent({ provider });
      await agent.run('Message 1');
      await agent.run('Message 2');

      const history = agent.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(4);
      expect(history.some((m) => m.content === 'Message 1')).toBe(true);
      expect(history.some((m) => m.content === 'Response 1')).toBe(true);
    });

    it('should reset conversation on reset()', async () => {
      const provider = createMockProvider([
        { content: 'Hello', finishReason: 'stop' },
      ]);

      const agent = createAgent({ provider });
      await agent.run('Hi');

      agent.reset();
      const history = agent.getHistory();
      // Only system message should remain
      expect(history.every((m) => m.role === 'system')).toBe(true);
    });

    it('should emit events via run$', async () => {
      const provider = createMockProvider([
        { content: 'Streamed response', finishReason: 'stop' },
      ]);

      const agent = createAgent({ provider });
      const events: string[] = [];

      await new Promise<void>((resolve) => {
        agent.run$('Test stream').subscribe({
          next: (event) => events.push(event.type),
          complete: () => resolve(),
        });
      });

      expect(events).toContain('step');
      expect(events).toContain('complete');
    });
  });

  describe('createDatabaseTools', () => {
    let db: DatabaseAdapter;

    beforeEach(() => {
      db = createMockDatabase();
    });

    it('should create 6 database tools', () => {
      const tools = createDatabaseTools(db);
      expect(tools).toHaveLength(6);

      const names = tools.map((t) => t.name);
      expect(names).toContain('query_documents');
      expect(names).toContain('get_document');
      expect(names).toContain('insert_document');
      expect(names).toContain('count_documents');
      expect(names).toContain('list_collections');
      expect(names).toContain('summarize_collection');
    });

    it('should query documents', async () => {
      const tools = createDatabaseTools(db);
      const queryTool = tools.find((t) => t.name === 'query_documents')!;

      const ctx: AgentContext = { messages: [], iteration: 1, config: {} as never };
      const result = await queryTool.execute({ collection: 'todos' }, ctx);

      expect(result.success).toBe(true);
      expect((result.data as { count: number }).count).toBe(3);
    });

    it('should query with filter', async () => {
      const tools = createDatabaseTools(db);
      const queryTool = tools.find((t) => t.name === 'query_documents')!;

      const ctx: AgentContext = { messages: [], iteration: 1, config: {} as never };
      const result = await queryTool.execute(
        { collection: 'todos', filter: { completed: false } },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as { count: number }).count).toBe(2);
    });

    it('should count documents', async () => {
      const tools = createDatabaseTools(db);
      const countTool = tools.find((t) => t.name === 'count_documents')!;

      const ctx: AgentContext = { messages: [], iteration: 1, config: {} as never };
      const result = await countTool.execute({ collection: 'todos' }, ctx);

      expect(result.success).toBe(true);
      expect((result.data as { count: number }).count).toBe(3);
    });

    it('should list collections', async () => {
      const tools = createDatabaseTools(db);
      const listTool = tools.find((t) => t.name === 'list_collections')!;

      const ctx: AgentContext = { messages: [], iteration: 1, config: {} as never };
      const result = await listTool.execute({}, ctx);

      expect(result.success).toBe(true);
      expect((result.data as { collections: string[] }).collections).toContain('todos');
    });

    it('should handle errors gracefully', async () => {
      const tools = createDatabaseTools(db);
      const queryTool = tools.find((t) => t.name === 'query_documents')!;

      const ctx: AgentContext = { messages: [], iteration: 1, config: {} as never };
      const result = await queryTool.execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('createConversationMemory', () => {
    it('should store and retrieve messages', () => {
      const memory = createConversationMemory();
      memory.add({ role: 'user', content: 'Hello' });
      memory.add({ role: 'assistant', content: 'Hi there' });

      const messages = memory.getMessages();
      expect(messages).toHaveLength(2);
    });

    it('should include system message', () => {
      const memory = createConversationMemory({ systemMessage: 'You are helpful.' });
      const messages = memory.getMessages();

      expect(messages[0]!.role).toBe('system');
      expect(messages[0]!.content).toBe('You are helpful.');
    });

    it('should prune old messages when exceeding max', () => {
      const memory = createConversationMemory({ maxMessages: 3 });

      memory.add({ role: 'user', content: '1' });
      memory.add({ role: 'assistant', content: '2' });
      memory.add({ role: 'user', content: '3' });
      memory.add({ role: 'assistant', content: '4' });

      expect(memory.size).toBe(3);
    });

    it('should preserve system messages on clear', () => {
      const memory = createConversationMemory({ systemMessage: 'System' });
      memory.add({ role: 'user', content: 'User msg' });
      memory.clear();

      expect(memory.size).toBe(1);
      expect(memory.getMessages()[0]!.role).toBe('system');
    });
  });

  describe('createToolRegistry', () => {
    const mockTool: Tool = {
      name: 'test_tool',
      description: 'A test tool',
      parameters: [
        { name: 'input', type: 'string', description: 'Input value', required: true },
      ],
      execute: async () => ({ success: true, data: 'ok' }),
    };

    it('should register and retrieve tools', () => {
      const registry = createToolRegistry([mockTool]);

      expect(registry.has('test_tool')).toBe(true);
      expect(registry.get('test_tool')).toBe(mockTool);
      expect(registry.getAll()).toHaveLength(1);
    });

    it('should generate tool schemas', () => {
      const registry = createToolRegistry([mockTool]);
      const schemas = registry.getSchemas();

      expect(schemas).toHaveLength(1);
      expect(schemas[0]!.name).toBe('test_tool');
      expect(schemas[0]!.parameters.required).toContain('input');
    });

    it('should unregister tools', () => {
      const registry = createToolRegistry([mockTool]);
      registry.unregister('test_tool');

      expect(registry.has('test_tool')).toBe(false);
      expect(registry.getAll()).toHaveLength(0);
    });
  });
});
