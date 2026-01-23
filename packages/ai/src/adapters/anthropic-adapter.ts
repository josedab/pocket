import type { AIStreamChunk, LLMAdapter, LLMConfig, Message } from '../types.js';

/**
 * Anthropic Claude LLM adapter
 */
export class AnthropicAdapter implements LLMAdapter {
  readonly provider = 'anthropic' as const;
  private readonly config: LLMConfig;
  private client: unknown;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;

    try {
      // Dynamic import to avoid bundling when not used
      const { Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl,
        defaultHeaders: this.config.headers,
      });
      return this.client;
    } catch {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }
  }

  private convertMessages(messages: Message[]): {
    system?: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  } {
    let system: string | undefined;
    const converted: { role: 'user' | 'assistant'; content: string }[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        converted.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return { system, messages: converted };
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
      messages: {
        create: (params: unknown) => Promise<{
          content: { text: string }[];
          usage: {
            input_tokens: number;
            output_tokens: number;
          };
        }>;
      };
    };

    const { system, messages: anthropicMessages } = this.convertMessages(messages);

    const response = await client.messages.create({
      model: this.config.model,
      system,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 1024,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      stop_sequences: options?.stop,
    });

    const content = response.content[0];
    if (!content || !('text' in content)) {
      throw new Error('No response from Anthropic');
    }

    return {
      content: content.text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
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
      messages: {
        create: (params: unknown) => Promise<
          AsyncIterable<{
            type: string;
            delta?: { text?: string };
          }>
        >;
      };
    };

    const { system, messages: anthropicMessages } = this.convertMessages(messages);

    const stream = await client.messages.create({
      model: this.config.model,
      system,
      messages: anthropicMessages,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 1024,
      temperature: options?.temperature ?? this.config.temperature ?? 0.7,
      stop_sequences: options?.stop,
      stream: true,
    });

    let accumulated = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        const delta = event.delta.text;
        accumulated += delta;
        yield {
          text: delta,
          done: false,
          accumulated,
        };
      }
    }

    yield {
      text: '',
      done: true,
      accumulated,
    };
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }
}

/**
 * Create an Anthropic adapter
 */
export function createAnthropicAdapter(config: Omit<LLMConfig, 'provider'>): AnthropicAdapter {
  return new AnthropicAdapter({ ...config, provider: 'anthropic' });
}
