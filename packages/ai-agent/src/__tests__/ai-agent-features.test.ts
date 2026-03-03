import { describe, expect, it, vi } from 'vitest';
import type { CollectionToolsConfig } from '../collection-tools.js';
import { createCollectionTools } from '../collection-tools.js';
import { createStreamingAgent } from '../streaming-agent.js';
import type { AgentContext, LLMProvider, LLMResponse } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockContext(): AgentContext {
  return {
    messages: [],
    iteration: 1,
    config: { provider: mockProvider([]) },
  };
}

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let idx = 0;
  return {
    name: 'mock',
    async complete() {
      const r = responses[idx % responses.length]!;
      idx++;
      return r;
    },
  };
}

function sampleDocs(): Record<string, unknown>[] {
  return [
    { _id: '1', title: 'Alpha', content: 'hello world', status: 'active' },
    { _id: '2', title: 'Beta', content: 'foo bar', status: 'archived' },
    { _id: '3', title: 'Gamma', content: 'baz qux', status: 'active' },
  ];
}

function defaultCollectionConfig(
  overrides?: Partial<CollectionToolsConfig>
): CollectionToolsConfig {
  const docs = sampleDocs();
  return {
    queryFn: vi.fn(async (_col, _q) => docs),
    insertFn: vi.fn(async (_col, doc) => ({ ...doc, _id: 'new-1' })),
    countFn: vi.fn(async () => docs.length),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Collection Tools
// ---------------------------------------------------------------------------

describe('createCollectionTools', () => {
  it('returns all expected tools without embeddingFn', () => {
    const tools = createCollectionTools(defaultCollectionConfig());
    const names = tools.map((t) => t.name);
    expect(names).toContain('queryCollection');
    expect(names).toContain('insertDocument');
    expect(names).toContain('countDocuments');
    expect(names).toContain('summarizeCollection');
    expect(names).not.toContain('semanticSearch');
  });

  it('includes semanticSearch when embeddingFn is provided', () => {
    const tools = createCollectionTools(
      defaultCollectionConfig({ embeddingFn: async () => [1, 0, 0] })
    );
    expect(tools.map((t) => t.name)).toContain('semanticSearch');
  });
});

describe('queryCollection tool', () => {
  it('executes with mock queryFn and returns documents', async () => {
    const cfg = defaultCollectionConfig();
    const tool = createCollectionTools(cfg).find((t) => t.name === 'queryCollection')!;
    const result = await tool.execute({ collection: 'posts' }, mockContext());
    expect(result.success).toBe(true);
    expect((result.data as { count: number }).count).toBe(3);
    expect(cfg.queryFn).toHaveBeenCalledWith('posts', expect.objectContaining({ limit: 20 }));
  });

  it('applies field projection', async () => {
    const tool = createCollectionTools(defaultCollectionConfig()).find(
      (t) => t.name === 'queryCollection'
    )!;
    const result = await tool.execute({ collection: 'posts', fields: ['title'] }, mockContext());
    expect(result.success).toBe(true);
    const docs = (result.data as { documents: Record<string, unknown>[] }).documents;
    expect(docs[0]).toEqual({ title: 'Alpha' });
    expect(docs[0]).not.toHaveProperty('_id');
  });

  it('fails when collection is missing', async () => {
    const tool = createCollectionTools(defaultCollectionConfig()).find(
      (t) => t.name === 'queryCollection'
    )!;
    const result = await tool.execute({}, mockContext());
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('insertDocument tool', () => {
  it('validates required params', async () => {
    const tool = createCollectionTools(defaultCollectionConfig()).find(
      (t) => t.name === 'insertDocument'
    )!;
    const result = await tool.execute({}, mockContext());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it('inserts a document successfully', async () => {
    const cfg = defaultCollectionConfig();
    const tool = createCollectionTools(cfg).find((t) => t.name === 'insertDocument')!;
    const result = await tool.execute(
      { collection: 'posts', document: { title: 'New' } },
      mockContext()
    );
    expect(result.success).toBe(true);
    expect(cfg.insertFn).toHaveBeenCalledWith('posts', { title: 'New' });
  });
});

describe('countDocuments tool', () => {
  it('returns count', async () => {
    const tool = createCollectionTools(defaultCollectionConfig()).find(
      (t) => t.name === 'countDocuments'
    )!;
    const result = await tool.execute({ collection: 'items' }, mockContext());
    expect(result.success).toBe(true);
    expect((result.data as { count: number }).count).toBe(3);
  });
});

describe('summarizeCollection tool', () => {
  it('generates schema stats', async () => {
    const tool = createCollectionTools(defaultCollectionConfig()).find(
      (t) => t.name === 'summarizeCollection'
    )!;
    const result = await tool.execute({ collection: 'posts' }, mockContext());
    expect(result.success).toBe(true);
    const data = result.data as {
      collection: string;
      totalDocuments: number;
      schema: Record<string, unknown>;
      sample: unknown[];
    };
    expect(data.collection).toBe('posts');
    expect(data.totalDocuments).toBe(3);
    expect(data.schema).toHaveProperty('title');
    expect(data.sample.length).toBeLessThanOrEqual(3);
  });
});

describe('semanticSearch tool', () => {
  it('ranks documents by cosine similarity', async () => {
    // Simple embedding: hash to a unit vector direction
    const embeddingMap: Record<string, number[]> = {
      'search query': [1, 0, 0],
      'hello world': [0.9, 0.1, 0],
      'foo bar': [0, 1, 0],
      'baz qux': [0, 0, 1],
    };
    const embeddingFn = async (text: string) => embeddingMap[text] ?? [0, 0, 0];

    const tool = createCollectionTools(defaultCollectionConfig({ embeddingFn })).find(
      (t) => t.name === 'semanticSearch'
    )!;

    const result = await tool.execute(
      { collection: 'posts', query: 'search query', limit: 2 },
      mockContext()
    );
    expect(result.success).toBe(true);
    const results = (result.data as { results: { _score: number; title: string }[] }).results;
    expect(results.length).toBe(2);
    // "hello world" should be most similar to [1,0,0]
    expect(results[0].title).toBe('Alpha');
    expect(results[0]._score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// StreamingAgent
// ---------------------------------------------------------------------------

describe('StreamingAgent', () => {
  it('run() completes with simple response', async () => {
    const provider = mockProvider([{ content: 'Hello!', finishReason: 'stop' }]);
    const agent = createStreamingAgent({ provider });
    const { content, steps } = await agent.run('Hi');
    expect(content).toBe('Hello!');
    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  it('handles tool calling loop', async () => {
    const provider = mockProvider([
      {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'tc1', name: 'myTool', arguments: { x: 1 } }],
      },
      { content: 'Done with tool', finishReason: 'stop' },
    ]);

    const myTool = {
      name: 'myTool',
      description: 'A test tool',
      parameters: [{ name: 'x', type: 'number' as const, description: 'A number', required: true }],
      execute: vi.fn(async () => ({ success: true, data: { value: 42 } })),
    };

    const agent = createStreamingAgent({ provider, tools: [myTool] });
    const { content } = await agent.run('Use the tool');
    expect(content).toBe('Done with tool');
    expect(myTool.execute).toHaveBeenCalled();
  });

  it('uses fallback provider when primary fails', async () => {
    const primary: LLMProvider = {
      name: 'primary',
      async complete() {
        throw new Error('Primary offline');
      },
    };
    const fallback = mockProvider([{ content: 'Fallback response', finishReason: 'stop' }]);

    const agent = createStreamingAgent(
      { provider: primary },
      { primaryProvider: primary, fallbackProvider: fallback }
    );
    const { content } = await agent.run('Test fallback');
    expect(content).toBe('Fallback response');
  });

  it('reset() clears state', async () => {
    const provider = mockProvider([
      { content: 'First', finishReason: 'stop' },
      { content: 'Second', finishReason: 'stop' },
    ]);
    const agent = createStreamingAgent({ provider, systemPrompt: 'You are helpful.' });

    await agent.run('Hello');
    expect(agent.getHistory().length).toBeGreaterThan(1);

    agent.reset();
    const history = agent.getHistory();
    // After reset, only system prompt remains
    expect(history.length).toBe(1);
    expect(history[0].role).toBe('system');
  });

  it('emits stream events in correct order', async () => {
    const provider = mockProvider([{ content: 'Hi there', finishReason: 'stop' }]);
    const agent = createStreamingAgent({ provider });
    const events: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const sub = agent.run$('Hey').subscribe({
        next: (e) => events.push(e.type),
        complete: () => {
          sub.unsubscribe();
          resolve();
        },
        error: (err) => {
          sub.unsubscribe();
          reject(err);
        },
      });
    });

    expect(events).toContain('text');
    expect(events[events.length - 1]).toBe('done');
  });
});
