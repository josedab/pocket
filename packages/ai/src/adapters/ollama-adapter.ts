import type { AIStreamChunk, LLMAdapter, LLMConfig, Message } from '../types.js';

/**
 * Ollama LLM adapter for local model inference
 */
export class OllamaAdapter implements LLMAdapter {
  readonly provider = 'ollama' as const;
  private readonly config: LLMConfig;
  private readonly baseUrl: string;

  constructor(config: LLMConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
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
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          num_predict: options?.maxTokens ?? this.config.maxTokens ?? 1024,
          temperature: options?.temperature ?? this.config.temperature ?? 0.7,
          stop: options?.stop,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message.content,
      usage:
        data.prompt_eval_count !== undefined && data.eval_count !== undefined
          ? {
              promptTokens: data.prompt_eval_count,
              completionTokens: data.eval_count,
              totalTokens: data.prompt_eval_count + data.eval_count,
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
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: true,
        options: {
          num_predict: options?.maxTokens ?? this.config.maxTokens ?? 1024,
          temperature: options?.temperature ?? this.config.temperature ?? 0.7,
          stop: options?.stop,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body from Ollama');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as {
              message?: { content: string };
              done: boolean;
            };

            if (data.message?.content) {
              accumulated += data.message.content;
              yield {
                text: data.message.content,
                done: data.done,
                accumulated,
              };
            }

            if (data.done) {
              yield {
                text: '',
                done: true,
                accumulated,
              };
              return;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      text: '',
      done: true,
      accumulated,
    };
  }

  isAvailable(): boolean {
    // Ollama is available if we have a base URL configured
    return !!this.baseUrl;
  }

  /**
   * Check if Ollama server is running
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: this.config.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers: this.config.headers,
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as {
        models: { name: string }[];
      };

      return data.models.map((m) => m.name);
    } catch {
      return [];
    }
  }
}

/**
 * Create an Ollama adapter
 */
export function createOllamaAdapter(config: Omit<LLMConfig, 'provider'>): OllamaAdapter {
  return new OllamaAdapter({ ...config, provider: 'ollama' });
}
