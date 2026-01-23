import type { Document } from '@pocket/core';

/**
 * Message role in a conversation
 */
export type MessageRole = 'system' | 'user' | 'assistant';

/**
 * A message in a conversation
 */
export interface Message {
  role: MessageRole;
  content: string;
}

/**
 * LLM provider types
 */
export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'webllm' | 'custom';

/**
 * Configuration for LLM providers
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
 * RAG (Retrieval-Augmented Generation) configuration
 */
export interface RAGConfig {
  /** Number of documents to retrieve for context */
  topK?: number;
  /** Minimum similarity score threshold */
  minScore?: number;
  /** Maximum context length in characters */
  maxContextLength?: number;
  /** Whether to include document metadata in context */
  includeMetadata?: boolean;
  /** Custom prompt template for RAG */
  promptTemplate?: string;
}

/**
 * AI Assistant configuration
 */
export interface AIAssistantConfig {
  /** LLM configuration */
  llm: LLMConfig;
  /** RAG configuration */
  rag?: RAGConfig;
  /** System prompt for the assistant */
  systemPrompt?: string;
  /** Whether to stream responses */
  streaming?: boolean;
}

/**
 * Context document used in RAG
 */
export interface ContextDocument<T extends Document = Document> {
  /** The document */
  document: T;
  /** Similarity score */
  score: number;
  /** Extracted text used for matching */
  text: string;
}

/**
 * Query options for AI assistant
 */
export interface AIQueryOptions {
  /** Override top-k for this query */
  topK?: number;
  /** Override min score for this query */
  minScore?: number;
  /** Additional context to include */
  additionalContext?: string;
  /** Conversation history for multi-turn */
  history?: Message[];
  /** Whether to stream the response */
  stream?: boolean;
  /** Collections to search (if multiple) */
  collections?: string[];
}

/**
 * Result from an AI query
 */
export interface AIQueryResult<T extends Document = Document> {
  /** The generated response */
  response: string;
  /** Documents used as context */
  context: ContextDocument<T>[];
  /** Token usage information */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Query processing time in ms */
  processingTime: number;
}

/**
 * Streaming chunk from AI response
 */
export interface AIStreamChunk {
  /** The text chunk */
  text: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Accumulated text so far */
  accumulated: string;
}

/**
 * LLM adapter interface for different providers
 */
export interface LLMAdapter {
  /** Provider name */
  readonly provider: LLMProvider;

  /**
   * Generate a completion
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
   * Generate a streaming completion
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
   * Check if the adapter is available/configured
   */
  isAvailable(): boolean;
}

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  /** Generate embeddings for texts */
  embed(texts: string[]): Promise<number[][]>;

  /** Get embedding dimensions */
  getDimensions(): number;

  /** Check if provider is available */
  isAvailable(): boolean;
}

/**
 * Prompt template variables
 */
export interface PromptVariables {
  /** User's query */
  query: string;
  /** Retrieved context documents */
  context: string;
  /** Conversation history */
  history?: string;
  /** Additional context */
  additionalContext?: string;
}

/**
 * Default RAG prompt template
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
 * Default system prompt
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant integrated with a local-first database. You have access to the user's documents and can answer questions about their data. Be helpful, accurate, and respect user privacy.`;
