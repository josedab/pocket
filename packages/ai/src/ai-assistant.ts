import type { Document } from '@pocket/core';
import type { VectorCollection } from '@pocket/vectors';
import { Subject, type Observable } from 'rxjs';
import { AnthropicAdapter } from './adapters/anthropic-adapter.js';
import { OllamaAdapter } from './adapters/ollama-adapter.js';
import { OpenAIAdapter } from './adapters/openai-adapter.js';
import { RAGPipeline } from './rag-pipeline.js';
import type {
  AIAssistantConfig,
  AIQueryOptions,
  AIQueryResult,
  AIStreamChunk,
  ContextDocument,
  LLMAdapter,
  LLMConfig,
  Message,
} from './types.js';
import { DEFAULT_SYSTEM_PROMPT } from './types.js';

/**
 * Create an LLM adapter based on config
 */
function createAdapter(config: LLMConfig): LLMAdapter {
  switch (config.provider) {
    case 'openai':
      return new OpenAIAdapter(config);
    case 'anthropic':
      return new AnthropicAdapter(config);
    case 'ollama':
      return new OllamaAdapter(config);
    case 'custom':
      throw new Error('Custom adapter must be provided directly');
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * AI Assistant with RAG capabilities
 */
export class AIAssistant<T extends Document = Document> {
  private readonly adapter: LLMAdapter;
  private readonly ragPipeline: RAGPipeline<T>;
  private readonly config: AIAssistantConfig;
  private conversationHistory: Message[] = [];

  constructor(
    vectorCollection: VectorCollection<T>,
    config: AIAssistantConfig,
    adapter?: LLMAdapter
  ) {
    this.config = config;
    this.adapter = adapter ?? createAdapter(config.llm);
    this.ragPipeline = new RAGPipeline(vectorCollection, config.rag);
  }

  /**
   * Query the AI assistant with RAG context
   */
  async query(question: string, options?: AIQueryOptions): Promise<AIQueryResult<T>> {
    const startTime = Date.now();

    // Retrieve relevant documents
    const context = await this.ragPipeline.retrieve(question, {
      topK: options?.topK ?? this.config.rag?.topK,
      minScore: options?.minScore ?? this.config.rag?.minScore,
    });

    // Build messages
    const messages = this.buildMessages(question, context, options);

    // Get completion
    const result = await this.adapter.complete(messages, {
      maxTokens: this.config.llm.maxTokens,
      temperature: this.config.llm.temperature,
    });

    // Update conversation history
    this.conversationHistory.push(
      { role: 'user', content: question },
      { role: 'assistant', content: result.content }
    );

    return {
      response: result.content,
      context,
      usage: result.usage,
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * Stream a query response
   */
  stream(
    question: string,
    options?: AIQueryOptions
  ): Observable<AIStreamChunk & { context?: ContextDocument<T>[] }> {
    const subject = new Subject<AIStreamChunk & { context?: ContextDocument<T>[] }>();

    void (async () => {
      try {
        // Retrieve relevant documents
        const context = await this.ragPipeline.retrieve(question, {
          topK: options?.topK ?? this.config.rag?.topK,
          minScore: options?.minScore ?? this.config.rag?.minScore,
        });

        // Emit context first
        subject.next({
          text: '',
          done: false,
          accumulated: '',
          context,
        });

        // Build messages
        const messages = this.buildMessages(question, context, options);

        // Stream completion
        let fullResponse = '';
        for await (const chunk of this.adapter.stream(messages, {
          maxTokens: this.config.llm.maxTokens,
          temperature: this.config.llm.temperature,
        })) {
          fullResponse = chunk.accumulated;
          subject.next(chunk);
        }

        // Update conversation history
        this.conversationHistory.push(
          { role: 'user', content: question },
          { role: 'assistant', content: fullResponse }
        );

        subject.complete();
      } catch (error) {
        subject.error(error);
      }
    })();

    return subject.asObservable();
  }

  /**
   * Simple query without RAG (direct LLM call)
   */
  async chat(
    message: string,
    options?: {
      systemPrompt?: string;
      history?: Message[];
    }
  ): Promise<string> {
    const messages: Message[] = [
      {
        role: 'system',
        content: options?.systemPrompt ?? this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      },
      ...(options?.history ?? this.conversationHistory),
      { role: 'user', content: message },
    ];

    const result = await this.adapter.complete(messages);

    this.conversationHistory.push(
      { role: 'user', content: message },
      { role: 'assistant', content: result.content }
    );

    return result.content;
  }

  /**
   * Build messages array for LLM
   */
  private buildMessages(
    question: string,
    context: ContextDocument<T>[],
    options?: AIQueryOptions
  ): Message[] {
    const systemPrompt = this.config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const ragPrompt = this.ragPipeline.buildPrompt(question, context, {
      history: options?.history ?? this.conversationHistory,
      additionalContext: options?.additionalContext,
    });

    const messages: Message[] = [{ role: 'system', content: systemPrompt }];

    // Include conversation history if available
    if (options?.history) {
      messages.push(...options.history);
    } else if (this.conversationHistory.length > 0) {
      // Limit history to last 10 messages to avoid context overflow
      const recentHistory = this.conversationHistory.slice(-10);
      messages.push(...recentHistory);
    }

    messages.push({ role: 'user', content: ragPrompt });

    return messages;
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history
   */
  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Set conversation history
   */
  setHistory(history: Message[]): void {
    this.conversationHistory = [...history];
  }

  /**
   * Search documents without generating response
   */
  async search(
    query: string,
    options?: {
      topK?: number;
      minScore?: number;
    }
  ): Promise<ContextDocument<T>[]> {
    return this.ragPipeline.retrieve(query, options);
  }

  /**
   * Check if the assistant is available
   */
  isAvailable(): boolean {
    return this.adapter.isAvailable();
  }

  /**
   * Get the RAG pipeline
   */
  getRAGPipeline(): RAGPipeline<T> {
    return this.ragPipeline;
  }
}

/**
 * Create an AI assistant
 */
export function createAIAssistant<T extends Document>(
  vectorCollection: VectorCollection<T>,
  config: AIAssistantConfig
): AIAssistant<T> {
  return new AIAssistant(vectorCollection, config);
}

/**
 * Create an AI assistant with OpenAI
 */
export function createOpenAIAssistant<T extends Document>(
  vectorCollection: VectorCollection<T>,
  apiKey: string,
  model = 'gpt-4o-mini'
): AIAssistant<T> {
  return new AIAssistant(vectorCollection, {
    llm: {
      provider: 'openai',
      model,
      apiKey,
    },
  });
}

/**
 * Create an AI assistant with Anthropic
 */
export function createAnthropicAssistant<T extends Document>(
  vectorCollection: VectorCollection<T>,
  apiKey: string,
  model = 'claude-3-haiku-20240307'
): AIAssistant<T> {
  return new AIAssistant(vectorCollection, {
    llm: {
      provider: 'anthropic',
      model,
      apiKey,
    },
  });
}

/**
 * Create an AI assistant with Ollama (local)
 */
export function createOllamaAssistant<T extends Document>(
  vectorCollection: VectorCollection<T>,
  model = 'llama3.2',
  baseUrl = 'http://localhost:11434'
): AIAssistant<T> {
  return new AIAssistant(vectorCollection, {
    llm: {
      provider: 'ollama',
      model,
      baseUrl,
    },
  });
}
