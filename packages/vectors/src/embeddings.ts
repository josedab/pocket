import { PocketError } from '@pocket/core';
import type { EmbeddingFunction, Vector } from './types.js';

/**
 * Configuration for OpenAI embedding function.
 *
 * @example
 * ```typescript
 * const config: OpenAIEmbeddingConfig = {
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'text-embedding-3-small',
 * };
 * ```
 */
export interface OpenAIEmbeddingConfig {
  /** OpenAI API key */
  apiKey: string;

  /**
   * Embedding model to use.
   * @default 'text-embedding-3-small'
   */
  model?: string;

  /**
   * Custom API base URL (for proxies or Azure OpenAI).
   * @default 'https://api.openai.com/v1'
   */
  baseUrl?: string;
}

/**
 * Create an OpenAI embedding function.
 *
 * Supports all OpenAI embedding models including:
 * - text-embedding-3-small (1536 dimensions, fastest)
 * - text-embedding-3-large (3072 dimensions, best quality)
 * - text-embedding-ada-002 (1536 dimensions, legacy)
 *
 * @param config - OpenAI configuration
 * @returns EmbeddingFunction for use with VectorStore/VectorCollection
 *
 * @example
 * ```typescript
 * const embedding = createOpenAIEmbedding({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   model: 'text-embedding-3-small',
 * });
 *
 * const vectorCollection = createVectorCollection(collection, {
 *   embeddingFunction: embedding,
 *   textFields: ['content'],
 * });
 * ```
 *
 * @see {@link EmbeddingFunction}
 */
export function createOpenAIEmbedding(config: OpenAIEmbeddingConfig): EmbeddingFunction {
  const model = config.model ?? 'text-embedding-3-small';
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';

  // Dimensions vary by model
  const dimensionsByModel: Record<string, number> = {
    'text-embedding-3-small': 1536,
    'text-embedding-3-large': 3072,
    'text-embedding-ada-002': 1536,
  };

  const dimensions = dimensionsByModel[model] ?? 1536;

  async function embed(text: string): Promise<Vector> {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw PocketError.fromCode('POCKET_C500', {
        message: `OpenAI API error: ${error}`,
        provider: 'openai',
        statusCode: response.status,
      });
    }

    const data = (await response.json()) as {
      data: { embedding: number[] }[];
    };

    return data.data[0]!.embedding;
  }

  async function embedBatch(texts: string[]): Promise<Vector[]> {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw PocketError.fromCode('POCKET_C500', {
        message: `OpenAI API error: ${error}`,
        provider: 'openai',
        statusCode: response.status,
      });
    }

    const data = (await response.json()) as {
      data: { embedding: number[]; index: number }[];
    };

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }

  return {
    embed,
    embedBatch,
    dimensions,
    modelName: model,
  };
}

/**
 * Configuration for Cohere embedding function.
 */
export interface CohereEmbeddingConfig {
  /** Cohere API key */
  apiKey: string;

  /**
   * Embedding model to use.
   * @default 'embed-english-v3.0'
   */
  model?: string;
}

/**
 * Create a Cohere embedding function.
 *
 * Supports Cohere embedding models:
 * - embed-english-v3.0 (1024 dimensions)
 * - embed-multilingual-v3.0 (1024 dimensions)
 * - embed-english-light-v3.0 (384 dimensions, faster)
 * - embed-multilingual-light-v3.0 (384 dimensions, faster)
 *
 * @param config - Cohere configuration
 * @returns EmbeddingFunction for use with VectorStore/VectorCollection
 *
 * @example
 * ```typescript
 * const embedding = createCohereEmbedding({
 *   apiKey: process.env.COHERE_API_KEY!,
 *   model: 'embed-english-v3.0',
 * });
 * ```
 */
export function createCohereEmbedding(config: CohereEmbeddingConfig): EmbeddingFunction {
  const model = config.model ?? 'embed-english-v3.0';

  const dimensionsByModel: Record<string, number> = {
    'embed-english-v3.0': 1024,
    'embed-multilingual-v3.0': 1024,
    'embed-english-light-v3.0': 384,
    'embed-multilingual-light-v3.0': 384,
  };

  const dimensions = dimensionsByModel[model] ?? 1024;

  async function embed(text: string): Promise<Vector> {
    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        texts: [text],
        input_type: 'search_document',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw PocketError.fromCode('POCKET_C500', {
        message: `Cohere API error: ${error}`,
        provider: 'cohere',
        statusCode: response.status,
      });
    }

    const data = (await response.json()) as {
      embeddings: number[][];
    };

    return data.embeddings[0]!;
  }

  async function embedBatch(texts: string[]): Promise<Vector[]> {
    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        texts,
        input_type: 'search_document',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw PocketError.fromCode('POCKET_C500', {
        message: `Cohere API error: ${error}`,
        provider: 'cohere',
        statusCode: response.status,
      });
    }

    const data = (await response.json()) as {
      embeddings: number[][];
    };

    return data.embeddings;
  }

  return {
    embed,
    embedBatch,
    dimensions,
    modelName: model,
  };
}

/**
 * Configuration for Ollama embedding function.
 *
 * Ollama provides local embedding generation without API calls,
 * keeping data completely private.
 */
export interface OllamaEmbeddingConfig {
  /**
   * Ollama model name.
   * @default 'nomic-embed-text'
   */
  model?: string;

  /**
   * Ollama server URL.
   * @default 'http://localhost:11434'
   */
  baseUrl?: string;

  /**
   * Embedding dimensions (varies by model).
   * @default 768
   */
  dimensions?: number;
}

/**
 * Create an Ollama embedding function for local embeddings.
 *
 * Runs embeddings locally using Ollama, keeping all data private.
 * Requires Ollama to be installed and running.
 *
 * Popular embedding models:
 * - nomic-embed-text (768 dimensions, good general purpose)
 * - mxbai-embed-large (1024 dimensions, higher quality)
 * - all-minilm (384 dimensions, very fast)
 *
 * @param config - Ollama configuration
 * @returns EmbeddingFunction for use with VectorStore/VectorCollection
 *
 * @example
 * ```typescript
 * // First, install the model: ollama pull nomic-embed-text
 *
 * const embedding = createOllamaEmbedding({
 *   model: 'nomic-embed-text',
 * });
 *
 * // All embeddings generated locally
 * const vectorCollection = createVectorCollection(collection, {
 *   embeddingFunction: embedding,
 *   textFields: ['content'],
 * });
 * ```
 *
 * @example Custom Ollama server
 * ```typescript
 * const embedding = createOllamaEmbedding({
 *   model: 'mxbai-embed-large',
 *   baseUrl: 'http://192.168.1.100:11434',
 *   dimensions: 1024,
 * });
 * ```
 */
export function createOllamaEmbedding(config: OllamaEmbeddingConfig = {}): EmbeddingFunction {
  const model = config.model ?? 'nomic-embed-text';
  const baseUrl = config.baseUrl ?? 'http://localhost:11434';
  const dimensions = config.dimensions ?? 768;

  async function embed(text: string): Promise<Vector> {
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw PocketError.fromCode('POCKET_C500', {
        message: `Ollama API error: ${error}`,
        provider: 'ollama',
        statusCode: response.status,
      });
    }

    const data = (await response.json()) as {
      embedding: number[];
    };

    return data.embedding;
  }

  async function embedBatch(texts: string[]): Promise<Vector[]> {
    // Ollama doesn't support batch embedding natively, so we do sequential calls
    return Promise.all(texts.map((t) => embed(t)));
  }

  return {
    embed,
    embedBatch,
    dimensions,
    modelName: model,
  };
}

/**
 * Function signature for single-text embedding.
 */
export type CustomEmbedFn = (text: string) => Promise<Vector>;

/**
 * Function signature for batch text embedding.
 */
export type CustomBatchEmbedFn = (texts: string[]) => Promise<Vector[]>;

/**
 * Create a custom embedding function from your own implementation.
 *
 * Use this to integrate with any embedding provider or local model
 * not covered by the built-in functions.
 *
 * @param embedFn - Function to embed single text
 * @param dimensions - Vector dimensionality
 * @param modelName - Model identifier
 * @param batchEmbedFn - Optional batch embedding function
 * @returns EmbeddingFunction for use with VectorStore/VectorCollection
 *
 * @example
 * ```typescript
 * const embedding = createCustomEmbedding(
 *   async (text) => {
 *     const response = await myEmbeddingAPI.embed(text);
 *     return response.vector;
 *   },
 *   384,
 *   'my-model',
 *   async (texts) => {
 *     const response = await myEmbeddingAPI.embedBatch(texts);
 *     return response.vectors;
 *   }
 * );
 * ```
 */
export function createCustomEmbedding(
  embedFn: CustomEmbedFn,
  dimensions: number,
  modelName: string,
  batchEmbedFn?: CustomBatchEmbedFn
): EmbeddingFunction {
  return {
    embed: embedFn,
    embedBatch: batchEmbedFn ?? ((texts) => Promise.all(texts.map(embedFn))),
    dimensions,
    modelName,
  };
}

/**
 * Create a test embedding function for development and testing.
 *
 * **WARNING: NOT for production use!**
 *
 * Generates deterministic pseudo-random vectors from text using hashing.
 * The same text always produces the same vector, making tests reproducible.
 * Does not capture semantic meaning.
 *
 * @param dimensions - Vector dimensionality (default: 384)
 * @returns EmbeddingFunction for testing
 *
 * @example
 * ```typescript
 * // In tests
 * const testEmbedding = createTestEmbedding(384);
 *
 * const store = createVectorStore({
 *   name: 'test-store',
 *   dimensions: 384,
 *   embeddingFunction: testEmbedding,
 * });
 *
 * // Deterministic: same text = same vector
 * const v1 = await testEmbedding.embed('hello');
 * const v2 = await testEmbedding.embed('hello');
 * // v1 === v2 (same values)
 * ```
 */
export function createTestEmbedding(dimensions = 384): EmbeddingFunction {
  function hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }

  function embed(text: string): Promise<Vector> {
    const vector = new Array(dimensions);
    const baseHash = hashCode(text);

    for (let i = 0; i < dimensions; i++) {
      // Generate pseudo-random but deterministic values
      const combined = hashCode(`${baseHash}_${i}`);
      vector[i] = (Math.sin(combined) + 1) / 2; // Normalize to 0-1
    }

    // Normalize to unit vector
    const norm = Math.sqrt(vector.reduce((sum: number, val: number) => sum + val * val, 0));
    const normalized = vector.map((val: number) => val / norm);

    return Promise.resolve(normalized);
  }

  return {
    embed,
    embedBatch: (texts) => Promise.all(texts.map(embed)),
    dimensions,
    modelName: 'test-embedding',
  };
}
