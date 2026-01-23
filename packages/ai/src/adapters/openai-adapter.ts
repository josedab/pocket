import type { AIStreamChunk, LLMAdapter, LLMConfig, Message } from '../types.js';

/**
 * OpenAI-compatible LLM adapter
 * Works with OpenAI API and compatible endpoints (Together, Groq, etc.)
 */
export class OpenAIAdapter implements LLMAdapter {
  readonly provider = 'openai' as const;
  private readonly config: LLMConfig;
  private client: unknown;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;

    try {
      // Dynamic import to avoid bundling when not used
      const { OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        defaultHeaders: this.config.headers,
      });
      return this.client;
    } catch {
      throw new Error('OpenAI SDK not installed. Run: npm install openai');
    }
  }

  async complete(
    messages: Message[],
    options?: {
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
    }
  ): Promise<{
    content: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }> {
    const client = (await this.getClient()) as {
      chat: {
        completions: {
          create: (params: unknown) => Promise<{
            choices: { message: { content: string | null } }[];
            usage?: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
          }>;
        };
      };
    };

    const response = await client.chat.completions.create({
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 1024,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      stop: options?.stop,
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    return {
      content: choice.message.content ?? '',
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(
    messages: Message[],
    options?: {
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
    }
  ): AsyncIterable<AIStreamChunk> {
    const client = (await this.getClient()) as {
      chat: {
        completions: {
          create: (params: unknown) => Promise<
            AsyncIterable<{
              choices: { delta: { content?: string } }[];
            }>
          >;
        };
      };
    };

    const stream = await client.chat.completions.create({
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 1024,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      stop: options?.stop,
      stream: true,
    });

    let accumulated = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      accumulated += delta;
      yield {
        text: delta,
        done: false,
        accumulated,
      };
    }

    yield {
      text: '',
      done: true,
      accumulated,
    };
  }

  isAvailable(): boolean {
    return !!this.config.apiKey || !!this.config.baseUrl;
  }
}

/**
 * Create an OpenAI adapter
 */
export function createOpenAIAdapter(config: Omit<LLMConfig, 'provider'>): OpenAIAdapter {
  return new OpenAIAdapter({ ...config, provider: 'openai' });
}
