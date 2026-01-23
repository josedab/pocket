import type { Document } from '@pocket/core';
import type { VectorCollection, VectorSearchResult } from '@pocket/vectors';
import type { ContextDocument, Message, PromptVariables, RAGConfig } from './types.js';
import { DEFAULT_RAG_PROMPT } from './types.js';

/**
 * Default RAG configuration values.
 *
 * @internal
 */
const DEFAULT_RAG_CONFIG: Required<RAGConfig> = {
  topK: 5,
  minScore: 0.5,
  maxContextLength: 8000,
  includeMetadata: true,
  promptTemplate: DEFAULT_RAG_PROMPT,
};

/**
 * Retrieval-Augmented Generation (RAG) pipeline.
 *
 * Handles the retrieval and formatting of relevant documents
 * to provide context for LLM queries. The pipeline:
 *
 * 1. Performs semantic search on the vector collection
 * 2. Filters results by similarity score
 * 3. Formats documents into a context string
 * 4. Builds the final prompt with the query and context
 *
 * @typeParam T - The document type in the vector collection
 *
 * @example Direct usage
 * ```typescript
 * const rag = new RAGPipeline(vectorCollection, {
 *   topK: 10,
 *   minScore: 0.6,
 * });
 *
 * // Retrieve relevant documents
 * const context = await rag.retrieve('project deadlines');
 *
 * // Build a prompt with context
 * const prompt = rag.buildPrompt('What are the deadlines?', context);
 * ```
 *
 * @example With AIAssistant (typical usage)
 * ```typescript
 * // RAGPipeline is created internally by AIAssistant
 * const assistant = createOpenAIAssistant(vectorCollection, apiKey);
 *
 * // Access the pipeline for advanced configuration
 * const rag = assistant.getRAGPipeline();
 * rag.updateConfig({ topK: 15 });
 * ```
 *
 * @see {@link AIAssistant} for typical usage
 * @see {@link RAGConfig} for configuration options
 */
export class RAGPipeline<T extends Document = Document> {
  private readonly vectorCollection: VectorCollection<T>;
  private readonly config: Required<RAGConfig>;

  constructor(vectorCollection: VectorCollection<T>, config: RAGConfig = {}) {
    this.vectorCollection = vectorCollection;
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
  }

  /**
   * Retrieve relevant documents for a query.
   *
   * Performs semantic search on the vector collection and
   * returns documents that meet the similarity threshold.
   *
   * @param query - The search query
   * @param options - Override default retrieval settings
   * @param options.topK - Maximum number of documents to retrieve
   * @param options.minScore - Minimum similarity score (0-1)
   * @returns Array of context documents with scores
   *
   * @example
   * ```typescript
   * const results = await rag.retrieve('meeting notes', {
   *   topK: 5,
   *   minScore: 0.7,
   * });
   *
   * for (const result of results) {
   *   console.log(`${result.document.title}: ${result.score}`);
   * }
   * ```
   */
  async retrieve(
    query: string,
    options?: {
      topK?: number;
      minScore?: number;
    }
  ): Promise<ContextDocument<T>[]> {
    const topK = options?.topK ?? this.config.topK;
    const minScore = options?.minScore ?? this.config.minScore;

    const results = await this.vectorCollection.search(query, {
      limit: topK,
      includeVectors: false,
      minScore,
    });

    return results
      .filter((r): r is VectorSearchResult & { document: T } => r.document !== undefined)
      .filter((r) => r.score >= minScore)
      .map((result) => ({
        document: result.document,
        score: result.score,
        text: this.extractText(result.document),
      }));
  }

  /**
   * Build a context string from retrieved documents.
   *
   * Formats documents into a text representation suitable for
   * including in an LLM prompt. Automatically truncates if the
   * content exceeds the maximum length.
   *
   * @param documents - Array of context documents
   * @param maxLength - Override maximum context length
   * @returns Formatted context string
   *
   * @example
   * ```typescript
   * const context = await rag.retrieve('deadlines');
   * const contextString = rag.buildContext(context, 4000);
   *
   * // Output format:
   * // [Document 1] (score: 0.892)
   * // Document content here...
   * //
   * // [Document 2] (score: 0.756)
   * // More content...
   * ```
   */
  buildContext(documents: ContextDocument<T>[], maxLength?: number): string {
    const max = maxLength ?? this.config.maxContextLength;
    const parts: string[] = [];
    let currentLength = 0;

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;
      const header = `[Document ${i + 1}]${this.config.includeMetadata ? ` (score: ${doc.score.toFixed(3)})` : ''}`;
      const content = doc.text;
      const entry = `${header}\n${content}\n`;

      if (currentLength + entry.length > max) {
        // Truncate last document if needed
        const remaining = max - currentLength;
        if (remaining > 100) {
          parts.push(`${header}\n${content.slice(0, remaining - header.length - 10)}...`);
        }
        break;
      }

      parts.push(entry);
      currentLength += entry.length;
    }

    return parts.join('\n');
  }

  /**
   * Build the full prompt with query and context.
   *
   * Interpolates the query, context, and optional conversation
   * history into the configured prompt template.
   *
   * @param query - The user's question
   * @param context - Retrieved context documents
   * @param options - Additional prompt options
   * @param options.history - Conversation history to include
   * @param options.additionalContext - Extra context or instructions
   * @param options.template - Override the default template
   * @returns The complete prompt string
   *
   * @example
   * ```typescript
   * const context = await rag.retrieve('tasks');
   * const prompt = rag.buildPrompt('What tasks are due?', context, {
   *   additionalContext: 'Focus on high-priority items',
   *   history: previousMessages,
   * });
   * ```
   */
  buildPrompt(
    query: string,
    context: ContextDocument<T>[],
    options?: {
      history?: Message[];
      additionalContext?: string;
      template?: string;
    }
  ): string {
    const template = options?.template ?? this.config.promptTemplate;
    const contextString = this.buildContext(context);

    const variables: PromptVariables = {
      query,
      context: contextString,
      history: options?.history ? this.formatHistory(options.history) : undefined,
      additionalContext: options?.additionalContext,
    };

    return this.interpolateTemplate(template, variables);
  }

  /**
   * Format conversation history for context
   */
  private formatHistory(history: Message[]): string {
    return history.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n');
  }

  /**
   * Interpolate template variables
   */
  private interpolateTemplate(template: string, variables: PromptVariables): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value ?? '');
    }

    return result;
  }

  /**
   * Extract text from a document (delegate to vector collection)
   */
  private extractText(doc: T): string {
    // Get all string fields from the document
    const parts: string[] = [];

    for (const [key, value] of Object.entries(doc)) {
      if (key.startsWith('_')) continue; // Skip metadata fields
      if (typeof value === 'string') {
        parts.push(value);
      }
    }

    return parts.join(' ');
  }

  /**
   * Get a copy of the current RAG configuration.
   *
   * @returns The current configuration with all defaults applied
   *
   * @example
   * ```typescript
   * const config = rag.getConfig();
   * console.log(`Using topK: ${config.topK}`);
   * ```
   */
  getConfig(): Required<RAGConfig> {
    return { ...this.config };
  }

  /**
   * Update the RAG configuration.
   *
   * Merges the provided config with existing settings.
   *
   * @param config - Partial configuration to merge
   *
   * @example
   * ```typescript
   * rag.updateConfig({
   *   topK: 15,
   *   minScore: 0.7,
   * });
   * ```
   */
  updateConfig(config: Partial<RAGConfig>): void {
    Object.assign(this.config, config);
  }
}

/**
 * Create a RAG pipeline instance.
 *
 * Factory function for creating RAGPipeline instances.
 * For most use cases, the pipeline is created automatically
 * when using {@link AIAssistant}.
 *
 * @typeParam T - The document type
 * @param vectorCollection - Vector collection for document retrieval
 * @param config - Optional RAG configuration
 * @returns A configured RAGPipeline instance
 *
 * @example
 * ```typescript
 * const rag = createRAGPipeline(vectorCollection, {
 *   topK: 10,
 *   minScore: 0.6,
 * });
 *
 * const results = await rag.retrieve('search query');
 * ```
 */
export function createRAGPipeline<T extends Document>(
  vectorCollection: VectorCollection<T>,
  config?: RAGConfig
): RAGPipeline<T> {
  return new RAGPipeline(vectorCollection, config);
}
