import type { Document } from '@pocket/core';

/**
 * Role of a message in a conversation.
 *
 * - `'system'`: Instructions for the AI assistant's behavior
 * - `'user'`: Messages from the human user
 * - `'assistant'`: Responses from the AI assistant
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * A message in a conversation with the AI assistant.
 *
 * @example
 * ```typescript
 * const messages: Message[] = [
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'What is TypeScript?' },
 *   { role: 'assistant', content: 'TypeScript is...' },
 * ];
 * ```
 */
export interface Message {
  /** The role of the message sender */
  role: MessageRole;
  /** The message content */
  content: string;
}

/**
 * Supported LLM provider types.
 *
 * - `'openai'`: OpenAI API (GPT-4, GPT-3.5, etc.)
 * - `'anthropic'`: Anthropic API (Claude models)
 * - `'ollama'`: Local Ollama instance
 * - `'webllm'`: Browser-based WebLLM
 * - `'custom'`: Custom adapter implementation
 */
export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'webllm' | 'custom';

/**
 * Configuration for LLM providers.
 *
 * @example OpenAI configuration
 * ```typescript
 * const config: LLMConfig = {
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   maxTokens: 2000,
 *   temperature: 0.7,
 * };
 * ```
 *
 * @example Ollama (local) configuration
 * ```typescript
 * const config: LLMConfig = {
 *   provider: 'ollama',
 *   model: 'llama3.2',
 *   baseUrl: 'http://localhost:11434',
 * };
 * ```
 */
export interface LLMConfig {
  /** Provider type */
  provider: LLMProvider;
  /** Model name/identifier */
  model: string;
  /** API key (for cloud providers) */
  apiKey?: string;
  /** API base URL (for self-hosted/ollama) */
  baseUrl?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Temperature (0-1) for response randomness */
  temperature?: number;
  /** Custom headers for API requests */
  headers?: Record<string, string>;
}

/**
 * Configuration for Retrieval-Augmented Generation (RAG).
 *
 * RAG enhances LLM responses by retrieving relevant documents
 * from your local data to provide context for the query.
 *
 * @example
 * ```typescript
 * const config: RAGConfig = {
 *   topK: 10,              // Retrieve top 10 documents
 *   minScore: 0.6,         // Only docs with 60%+ similarity
 *   maxContextLength: 4000, // Limit context to 4000 chars
 *   includeMetadata: true,  // Show document scores in context
 * };
 * ```
 */
export interface RAGConfig {
  /**
   * Number of documents to retrieve for context.
   * @default 5
   */
  topK?: number;

  /**
   * Minimum similarity score threshold (0-1).
   * Documents below this score are filtered out.
   * @default 0.5
   */
  minScore?: number;

  /**
   * Maximum context length in characters.
   * Prevents context from exceeding LLM token limits.
   * @default 8000
   */
  maxContextLength?: number;

  /**
   * Whether to include document metadata (scores) in context.
   * @default true
   */
  includeMetadata?: boolean;

  /**
   * Custom prompt template for RAG.
   * Use placeholders: {query}, {context}, {history}, {additionalContext}
   */
  promptTemplate?: string;
}

/**
 * Complete configuration for an AI Assistant.
 *
 * @example Full configuration
 * ```typescript
 * const config: AIAssistantConfig = {
 *   llm: {
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     apiKey: process.env.OPENAI_API_KEY!,
 *     temperature: 0.7,
 *   },
 *   rag: {
 *     topK: 10,
 *     minScore: 0.6,
 *   },
 *   systemPrompt: 'You are a helpful notes assistant.',
 *   streaming: true,
 * };
 * ```
 *
 * @see {@link AIAssistant}
 * @see {@link createAIAssistant}
 */
export interface AIAssistantConfig {
  /** LLM provider and model configuration */
  llm: LLMConfig;

  /** RAG (retrieval) configuration */
  rag?: RAGConfig;

  /** System prompt defining assistant behavior */
  systemPrompt?: string;

  /** Whether to enable streaming responses by default */
  streaming?: boolean;
}

/**
 * A document retrieved as context for RAG queries.
 *
 * Contains the original document, its similarity score,
 * and the extracted text that matched the query.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * const result = await assistant.query('meeting notes');
 *
 * for (const ctx of result.context) {
 *   console.log(`Score: ${ctx.score.toFixed(3)}`);
 *   console.log(`Title: ${ctx.document.title}`);
 *   console.log(`Preview: ${ctx.text.slice(0, 100)}...`);
 * }
 * ```
 */
export interface ContextDocument<T extends Document = Document> {
  /** The original document from the collection */
  document: T;

  /** Similarity score (0-1, higher is more similar) */
  score: number;

  /** Extracted text content used for matching */
  text: string;
}

/**
 * Options for AI assistant queries.
 *
 * Allows overriding default RAG and conversation settings
 * on a per-query basis.
 *
 * @example
 * ```typescript
 * const result = await assistant.query('important deadlines', {
 *   topK: 20,                    // More context
 *   minScore: 0.7,               // Higher relevance
 *   additionalContext: 'Focus on tasks due this week',
 * });
 * ```
 */
export interface AIQueryOptions {
  /** Override default topK for this query */
  topK?: number;

  /** Override default minScore for this query */
  minScore?: number;

  /** Additional instructions or context for the LLM */
  additionalContext?: string;

  /** Explicit conversation history (overrides internal history) */
  history?: Message[];

  /** Whether to stream the response */
  stream?: boolean;

  /** Specific collections to search (for multi-collection setups) */
  collections?: string[];
}

/**
 * Result from an AI assistant query.
 *
 * Contains the generated response, source documents used as context,
 * token usage statistics, and timing information.
 *
 * @typeParam T - The document type
 *
 * @example
 * ```typescript
 * const result = await assistant.query('What tasks are pending?');
 *
 * console.log('Response:', result.response);
 * console.log(`Based on ${result.context.length} documents`);
 * console.log(`Processing time: ${result.processingTime}ms`);
 *
 * if (result.usage) {
 *   console.log(`Tokens used: ${result.usage.totalTokens}`);
 * }
 * ```
 */
export interface AIQueryResult<T extends Document = Document> {
  /** The generated text response from the LLM */
  response: string;

  /** Documents retrieved and used as context */
  context: ContextDocument<T>[];

  /** Token usage statistics (if provided by the LLM) */
  usage?: {
    /** Tokens in the prompt (including context) */
    promptTokens: number;
    /** Tokens in the generated response */
    completionTokens: number;
    /** Total tokens used */
    totalTokens: number;
  };

  /** Total query processing time in milliseconds */
  processingTime: number;
}

/**
 * A chunk from a streaming AI response.
 *
 * Emitted incrementally as the LLM generates its response.
 *
 * @example
 * ```typescript
 * assistant.stream('Explain this concept').subscribe({
 *   next: (chunk: AIStreamChunk) => {
 *     // Print incremental text
 *     process.stdout.write(chunk.text);
 *
 *     // Or use accumulated for state updates
 *     setResponse(chunk.accumulated);
 *
 *     if (chunk.done) {
 *       console.log('\n--- Complete ---');
 *     }
 *   },
 * });
 * ```
 */
export interface AIStreamChunk {
  /** The new text in this chunk */
  text: string;

  /** Whether this is the final chunk */
  done: boolean;

  /** All text accumulated so far (including this chunk) */
  accumulated: string;
}

/**
 * Adapter interface for LLM providers.
 *
 * Implement this interface to add support for custom LLM providers.
 * Built-in adapters are available for OpenAI, Anthropic, and Ollama.
 *
 * @example Custom adapter implementation
 * ```typescript
 * class MyLLMAdapter implements LLMAdapter {
 *   readonly provider: LLMProvider = 'custom';
 *
 *   async complete(messages: Message[]): Promise<{ content: string }> {
 *     const response = await myLLMAPI.chat(messages);
 *     return { content: response.text };
 *   }
 *
 *   async *stream(messages: Message[]): AsyncIterable<AIStreamChunk> {
 *     for await (const chunk of myLLMAPI.streamChat(messages)) {
 *       yield { text: chunk, done: false, accumulated: '' };
 *     }
 *   }
 *
 *   isAvailable(): boolean {
 *     return true;
 *   }
 * }
 * ```
 */
export interface LLMAdapter {
  /** The provider type this adapter implements */
  readonly provider: LLMProvider;

  /**
   * Generate a completion (non-streaming).
   *
   * @param messages - Conversation messages
   * @param options - Generation options
   * @returns The generated content and optional usage stats
   */
  complete(
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
  }>;

  /**
   * Generate a streaming completion.
   *
   * @param messages - Conversation messages
   * @param options - Generation options
   * @returns Async iterable of stream chunks
   */
  stream(
    messages: Message[],
    options?: {
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
    }
  ): AsyncIterable<AIStreamChunk>;

  /**
   * Check if the adapter is properly configured and available.
   *
   * @returns `true` if the adapter can accept requests
   */
  isAvailable(): boolean;
}

/**
 * Interface for embedding providers that convert text to vectors.
 *
 * Used internally by vector collections for semantic search.
 *
 * @example Custom embedding provider
 * ```typescript
 * class MyEmbeddingProvider implements EmbeddingProvider {
 *   async embed(texts: string[]): Promise<number[][]> {
 *     const response = await myEmbeddingAPI.embed(texts);
 *     return response.embeddings;
 *   }
 *
 *   getDimensions(): number {
 *     return 384;  // Embedding vector size
 *   }
 *
 *   isAvailable(): boolean {
 *     return !!this.apiKey;
 *   }
 * }
 * ```
 */
export interface EmbeddingProvider {
  /**
   * Generate embeddings for multiple texts.
   *
   * @param texts - Array of text strings to embed
   * @returns Array of embedding vectors (one per input text)
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Get the dimensionality of the embedding vectors.
   *
   * @returns Number of dimensions in each embedding vector
   */
  getDimensions(): number;

  /**
   * Check if the provider is available and configured.
   *
   * @returns `true` if the provider can generate embeddings
   */
  isAvailable(): boolean;
}

/**
 * Variables available in RAG prompt templates.
 *
 * Use these placeholders in custom prompt templates:
 * `{query}`, `{context}`, `{history}`, `{additionalContext}`
 *
 * @example Custom template
 * ```typescript
 * const template = `
 * Based on these documents:
 * {context}
 *
 * Previous conversation:
 * {history}
 *
 * Answer: {query}
 * `;
 * ```
 */
export interface PromptVariables {
  /** The user's query/question */
  query: string;

  /** Formatted context from retrieved documents */
  context: string;

  /** Formatted conversation history (if available) */
  history?: string;

  /** Additional context or instructions */
  additionalContext?: string;
}

/**
 * Default RAG prompt template.
 *
 * Used when no custom template is provided in RAGConfig.
 * Contains placeholders that are replaced with actual values.
 *
 * @see {@link RAGConfig.promptTemplate}
 */
export const DEFAULT_RAG_PROMPT = `You are a helpful AI assistant with access to the user's local data. Answer questions based on the provided context.

Context from user's documents:
{context}

{additionalContext}

User's question: {query}

Instructions:
- Answer based on the provided context when relevant
- If the context doesn't contain relevant information, say so
- Be concise and helpful
- Cite specific documents when referencing information`;

/**
 * Default system prompt for the AI assistant.
 *
 * Sets the baseline behavior and context for the assistant.
 * Can be overridden via {@link AIAssistantConfig.systemPrompt}.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant integrated with a local-first database. You have access to the user's documents and can answer questions about their data. Be helpful, accurate, and respect user privacy.`;
