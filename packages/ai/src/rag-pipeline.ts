import type { Document } from '@pocket/core';
import type { VectorCollection, VectorSearchResult } from '@pocket/vectors';
import type { ContextDocument, Message, PromptVariables, RAGConfig } from './types.js';
import { DEFAULT_RAG_PROMPT } from './types.js';

/**
 * Default RAG configuration
 */
const DEFAULT_RAG_CONFIG: Required<RAGConfig> = {
  topK: 5,
  minScore: 0.5,
  maxContextLength: 8000,
  includeMetadata: true,
  promptTemplate: DEFAULT_RAG_PROMPT,
};

/**
 * RAG (Retrieval-Augmented Generation) pipeline
 * Handles document retrieval and context building for AI queries
 */
export class RAGPipeline<T extends Document = Document> {
  private readonly vectorCollection: VectorCollection<T>;
  private readonly config: Required<RAGConfig>;

  constructor(vectorCollection: VectorCollection<T>, config: RAGConfig = {}) {
    this.vectorCollection = vectorCollection;
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
  }

  /**
   * Retrieve relevant documents for a query
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
   * Build context string from retrieved documents
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
   * Build the full prompt with context
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
   * Get configuration
   */
  getConfig(): Required<RAGConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RAGConfig>): void {
    Object.assign(this.config, config);
  }
}

/**
 * Create a RAG pipeline
 */
export function createRAGPipeline<T extends Document>(
  vectorCollection: VectorCollection<T>,
  config?: RAGConfig
): RAGPipeline<T> {
  return new RAGPipeline(vectorCollection, config);
}
