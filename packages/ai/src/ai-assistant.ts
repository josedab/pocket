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
 * Create an LLM adapter based on the provider specified in config.
 *
 * @param config - LLM configuration specifying the provider
 * @returns An adapter instance for the specified provider
 * @throws Error if provider is 'custom' without a pre-created adapter
 * @throws Error if provider is unknown
 *
 * @internal
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
 * AI Assistant with Retrieval-Augmented Generation (RAG) capabilities.
 *
 * Combines LLM capabilities with vector search to provide context-aware
 * responses based on your local documents. Supports multiple LLM providers
 * (OpenAI, Anthropic, Ollama) and maintains conversation history.
 *
 * @typeParam T - The document type stored in the vector collection
 *
 * @example Basic usage with OpenAI
 * ```typescript
 * const assistant = createOpenAIAssistant(
 *   vectorCollection,
 *   process.env.OPENAI_API_KEY!
 * );
 *
 * const result = await assistant.query('What are my pending tasks?');
 * console.log(result.response);
 * console.log(`Used ${result.context.length} documents as context`);
 * ```
 *
 * @example Streaming responses
 * ```typescript
 * assistant.stream('Summarize my notes').subscribe({
 *   next: (chunk) => {
 *     if (chunk.context) {
 *       console.log('Context retrieved:', chunk.context.length);
 *     }
 *     process.stdout.write(chunk.text);
 *   },
 *   complete: () => console.log('\nDone'),
 * });
 * ```
 *
 * @example Custom configuration
 * ```typescript
 * const assistant = new AIAssistant(vectorCollection, {
 *   llm: {
 *     provider: 'anthropic',
 *     model: 'claude-3-sonnet-20240229',
 *     apiKey: process.env.ANTHROPIC_API_KEY!,
 *     temperature: 0.7,
 *     maxTokens: 2000,
 *   },
 *   rag: {
 *     topK: 10,
 *     minScore: 0.6,
 *     includeMetadata: true,
 *   },
 *   systemPrompt: 'You are a helpful assistant for a notes app.',
 * });
 * ```
 *
 * @see {@link createAIAssistant} for factory function
 * @see {@link createOpenAIAssistant} for OpenAI quick setup
 * @see {@link createAnthropicAssistant} for Anthropic quick setup
 * @see {@link createOllamaAssistant} for local LLM setup
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
   * Query the AI assistant with RAG context.
   *
   * Retrieves relevant documents from the vector collection, builds
   * context, and generates a response from the LLM. The conversation
   * history is automatically maintained.
   *
   * @param question - The question or prompt to send to the assistant
   * @param options - Optional query configuration overrides
   * @returns Query result including response, context documents, and usage stats
   *
   * @example Basic query
   * ```typescript
   * const result = await assistant.query('What tasks are due this week?');
   * console.log(result.response);
   *
   * // Show source documents
   * for (const doc of result.context) {
   *   console.log(`- ${doc.document.title} (score: ${doc.score})`);
   * }
   * ```
   *
   * @example With options
   * ```typescript
   * const result = await assistant.query('Find related notes', {
   *   topK: 15,           // Retrieve more context
   *   minScore: 0.7,      // Higher relevance threshold
   *   additionalContext: 'Focus on notes from this month',
   * });
   * ```
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
   * Stream a query response for real-time output.
   *
   * Similar to {@link query}, but returns an Observable that emits
   * chunks as they arrive from the LLM. The first emission includes
   * the context documents; subsequent emissions contain text chunks.
   *
   * @param question - The question or prompt to send
   * @param options - Optional query configuration overrides
   * @returns Observable emitting stream chunks with optional context
   *
   * @example Streaming to console
   * ```typescript
   * assistant.stream('Explain my project structure').subscribe({
   *   next: (chunk) => {
   *     if (chunk.context) {
   *       // First chunk contains retrieved context
   *       console.log(`Found ${chunk.context.length} relevant documents`);
   *     }
   *     // Print text as it arrives
   *     process.stdout.write(chunk.text);
   *   },
   *   error: (err) => console.error('Stream error:', err),
   *   complete: () => console.log('\n--- Done ---'),
   * });
   * ```
   *
   * @example React integration
   * ```typescript
   * const [response, setResponse] = useState('');
   *
   * useEffect(() => {
   *   const sub = assistant.stream(question).subscribe({
   *     next: (chunk) => setResponse(chunk.accumulated),
   *   });
   *   return () => sub.unsubscribe();
   * }, [question]);
   * ```
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
   * Simple chat without RAG (direct LLM call).
   *
   * Bypasses document retrieval and sends the message directly to the LLM.
   * Useful for general conversation or when context is already provided.
   *
   * @param message - The message to send
   * @param options - Optional chat configuration
   * @param options.systemPrompt - Override the default system prompt
   * @param options.history - Override conversation history
   * @returns The assistant's response text
   *
   * @example Simple chat
   * ```typescript
   * const response = await assistant.chat('Hello, how can you help me?');
   * console.log(response);
   * ```
   *
   * @example With custom system prompt
   * ```typescript
   * const response = await assistant.chat('Translate to French: Hello', {
   *   systemPrompt: 'You are a translator. Translate the given text.',
   *   history: [], // Start fresh without history
   * });
   * ```
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
   * Clear the conversation history.
   *
   * Resets the assistant's memory of previous exchanges.
   * Call this when starting a new topic or conversation.
   *
   * @example
   * ```typescript
   * // After finishing one topic
   * assistant.clearHistory();
   *
   * // Start fresh conversation
   * const result = await assistant.query('New topic question');
   * ```
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get a copy of the conversation history.
   *
   * @returns Array of messages in the conversation
   *
   * @example
   * ```typescript
   * const history = assistant.getHistory();
   * console.log(`${history.length} messages in conversation`);
   *
   * // Save for later
   * localStorage.setItem('chatHistory', JSON.stringify(history));
   * ```
   */
  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  /**
   * Set the conversation history.
   *
   * Useful for restoring a previous conversation or
   * providing pre-defined context.
   *
   * @param history - Array of messages to set as history
   *
   * @example Restore saved history
   * ```typescript
   * const saved = JSON.parse(localStorage.getItem('chatHistory') || '[]');
   * assistant.setHistory(saved);
   * ```
   *
   * @example Pre-seed with context
   * ```typescript
   * assistant.setHistory([
   *   { role: 'user', content: 'My name is Alice' },
   *   { role: 'assistant', content: 'Nice to meet you, Alice!' },
   * ]);
   * ```
   */
  setHistory(history: Message[]): void {
    this.conversationHistory = [...history];
  }

  /**
   * Search documents without generating an LLM response.
   *
   * Useful for document retrieval, showing search results,
   * or building custom workflows.
   *
   * @param query - The search query
   * @param options - Search options
   * @param options.topK - Maximum number of documents to return
   * @param options.minScore - Minimum similarity score threshold (0-1)
   * @returns Array of matching documents with scores
   *
   * @example Basic search
   * ```typescript
   * const results = await assistant.search('project deadlines');
   *
   * for (const result of results) {
   *   console.log(`${result.document.title}: ${result.score.toFixed(3)}`);
   * }
   * ```
   *
   * @example With options
   * ```typescript
   * const results = await assistant.search('important', {
   *   topK: 20,
   *   minScore: 0.8,  // Only highly relevant results
   * });
   * ```
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
   * Check if the assistant is available and configured.
   *
   * Verifies that the LLM adapter is properly set up and
   * can accept requests.
   *
   * @returns `true` if the assistant can process queries
   *
   * @example
   * ```typescript
   * if (!assistant.isAvailable()) {
   *   console.error('AI assistant not configured');
   *   return;
   * }
   * ```
   */
  isAvailable(): boolean {
    return this.adapter.isAvailable();
  }

  /**
   * Get the underlying RAG pipeline for advanced configuration.
   *
   * @returns The RAGPipeline instance
   *
   * @example
   * ```typescript
   * const rag = assistant.getRAGPipeline();
   * rag.updateConfig({ topK: 15 });
   * ```
   */
  getRAGPipeline(): RAGPipeline<T> {
    return this.ragPipeline;
  }
}

/**
 * Create an AI assistant with full configuration.
 *
 * Use this factory function for custom LLM and RAG configuration.
 * For simpler setups, see the provider-specific factory functions.
 *
 * @typeParam T - The document type
 * @param vectorCollection - Vector collection for document retrieval
 * @param config - Full assistant configuration
 * @returns A configured AIAssistant instance
 *
 * @example
 * ```typescript
 * const assistant = createAIAssistant(vectorCollection, {
 *   llm: {
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     apiKey: process.env.OPENAI_API_KEY!,
 *     temperature: 0.5,
 *   },
 *   rag: {
 *     topK: 10,
 *     minScore: 0.6,
 *   },
 *   systemPrompt: 'You are a helpful note-taking assistant.',
 * });
 * ```
 *
 * @see {@link createOpenAIAssistant} for OpenAI quick setup
 * @see {@link createAnthropicAssistant} for Anthropic quick setup
 * @see {@link createOllamaAssistant} for local LLM setup
 */
export function createAIAssistant<T extends Document>(
  vectorCollection: VectorCollection<T>,
  config: AIAssistantConfig
): AIAssistant<T> {
  return new AIAssistant(vectorCollection, config);
}

/**
 * Create an AI assistant powered by OpenAI.
 *
 * Quick setup for OpenAI-based assistants with sensible defaults.
 *
 * @typeParam T - The document type
 * @param vectorCollection - Vector collection for document retrieval
 * @param apiKey - OpenAI API key
 * @param model - Model to use (default: 'gpt-4o-mini')
 * @returns A configured AIAssistant instance
 *
 * @example
 * ```typescript
 * const assistant = createOpenAIAssistant(
 *   vectorCollection,
 *   process.env.OPENAI_API_KEY!,
 *   'gpt-4o'  // Use GPT-4o for better quality
 * );
 *
 * const result = await assistant.query('Summarize my notes');
 * ```
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
 * Create an AI assistant powered by Anthropic Claude.
 *
 * Quick setup for Anthropic-based assistants with sensible defaults.
 *
 * @typeParam T - The document type
 * @param vectorCollection - Vector collection for document retrieval
 * @param apiKey - Anthropic API key
 * @param model - Model to use (default: 'claude-3-haiku-20240307')
 * @returns A configured AIAssistant instance
 *
 * @example
 * ```typescript
 * const assistant = createAnthropicAssistant(
 *   vectorCollection,
 *   process.env.ANTHROPIC_API_KEY!,
 *   'claude-3-sonnet-20240229'  // Use Sonnet for better quality
 * );
 *
 * const result = await assistant.query('Analyze my recent entries');
 * ```
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
 * Create an AI assistant powered by Ollama (local LLM).
 *
 * Run AI completely locally without sending data to external services.
 * Requires Ollama to be installed and running.
 *
 * @typeParam T - The document type
 * @param vectorCollection - Vector collection for document retrieval
 * @param model - Ollama model name (default: 'llama3.2')
 * @param baseUrl - Ollama server URL (default: 'http://localhost:11434')
 * @returns A configured AIAssistant instance
 *
 * @example
 * ```typescript
 * // Ensure Ollama is running: ollama serve
 * // Pull a model: ollama pull llama3.2
 *
 * const assistant = createOllamaAssistant(
 *   vectorCollection,
 *   'llama3.2'
 * );
 *
 * const result = await assistant.query('What are my pending tasks?');
 * ```
 *
 * @example Custom Ollama server
 * ```typescript
 * const assistant = createOllamaAssistant(
 *   vectorCollection,
 *   'mistral',
 *   'http://192.168.1.100:11434'
 * );
 * ```
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
