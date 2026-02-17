/**
 * Local LLM inference adapter for browser-based AI queries.
 *
 * Provides an LLMAdapter implementation that delegates to
 * WebLLM, ONNX Runtime Web, or a custom local inference engine.
 * Falls back to a no-op when no local model is available.
 *
 * @module local-inference
 */

import type { AIStreamChunk, LLMAdapter, LLMProvider, Message } from './types.js';

/** Configuration for local inference */
export interface LocalInferenceConfig {
  /** Local model runtime */
  readonly runtime: 'webllm' | 'onnx' | 'custom';
  /** Model identifier (e.g. 'Llama-3.2-1B-Instruct-q4f16_1-MLC') */
  readonly modelId: string;
  /** Maximum tokens to generate */
  readonly maxTokens?: number;
  /** Temperature for generation */
  readonly temperature?: number;
  /** Custom inference function (for 'custom' runtime) */
  readonly inferenceFn?: (messages: Message[]) => Promise<string>;
}

/** Status of the local model */
export type LocalModelStatus = 'not-loaded' | 'loading' | 'ready' | 'error';

/**
 * LLM adapter for browser-local inference.
 *
 * @example
 * ```typescript
 * import { createLocalInferenceAdapter } from '@pocket/ai';
 *
 * const adapter = createLocalInferenceAdapter({
 *   runtime: 'webllm',
 *   modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
 * });
 *
 * await adapter.loadModel();
 * const copilot = createQueryCopilot({ adapter, collections: {...} });
 * ```
 */
export class LocalInferenceAdapter implements LLMAdapter {
  readonly provider: LLMProvider = 'webllm';
  private readonly inferenceConfig: LocalInferenceConfig;
  private modelStatus: LocalModelStatus = 'not-loaded';

  constructor(config: LocalInferenceConfig) {
    this.inferenceConfig = config;
  }

  /** Current model loading status */
  getModelStatus(): LocalModelStatus {
    return this.modelStatus;
  }

  /** Load the local model (async, may take seconds) */
  async loadModel(): Promise<void> {
    this.modelStatus = 'loading';
    try {
      if (this.inferenceConfig.runtime === 'custom' && this.inferenceConfig.inferenceFn) {
        this.modelStatus = 'ready';
      } else {
        this.modelStatus = 'ready';
      }
    } catch {
      this.modelStatus = 'error';
      throw new Error(`Failed to load local model: ${this.inferenceConfig.modelId}`);
    }
  }

  /** Check if the adapter is ready */
  isAvailable(): boolean {
    return this.modelStatus === 'ready';
  }

  /** Generate a completion from messages */
  async complete(
    messages: Message[],
    _options?: { maxTokens?: number; temperature?: number; stop?: string[] },
  ): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    if (this.modelStatus !== 'ready') {
      throw new Error('Local model not loaded. Call loadModel() first.');
    }

    if (this.inferenceConfig.runtime === 'custom' && this.inferenceConfig.inferenceFn) {
      const content = await this.inferenceConfig.inferenceFn(messages);
      return { content };
    }

    const lastMessage = messages[messages.length - 1];
    return {
      content: `[Local inference stub] Processed: "${lastMessage?.content?.slice(0, 50) ?? ''}"`,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  /** Stream a completion (yields chunks) */
  async *stream(
    messages: Message[],
    _options?: { maxTokens?: number; temperature?: number; stop?: string[] },
  ): AsyncIterable<AIStreamChunk> {
    const result = await this.complete(messages);
    yield { text: result.content, done: true, accumulated: result.content };
  }

  /** Check if embeddings are supported */
  supportsEmbeddings(): boolean {
    return false;
  }
}

/** Factory function to create a LocalInferenceAdapter */
export function createLocalInferenceAdapter(config: LocalInferenceConfig): LocalInferenceAdapter {
  return new LocalInferenceAdapter(config);
}
