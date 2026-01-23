import type { EmbeddingFunction, Vector } from './types.js';

/**
 * OpenAI embedding function configuration
 */
export interface OpenAIEmbeddingConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/**
 * Create an OpenAI embedding function
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
      throw new Error(`OpenAI API error: ${error}`);
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
      throw new Error(`OpenAI API error: ${error}`);
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
 * Cohere embedding function configuration
 */
export interface CohereEmbeddingConfig {
  apiKey: string;
  model?: string;
}

/**
 * Create a Cohere embedding function
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
      throw new Error(`Cohere API error: ${error}`);
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
      throw new Error(`Cohere API error: ${error}`);
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
 * Ollama embedding function configuration
 */
export interface OllamaEmbeddingConfig {
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

/**
 * Create an Ollama embedding function (for local embeddings)
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
      throw new Error(`Ollama API error: ${error}`);
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
 * Custom embedding function type
 */
export type CustomEmbedFn = (text: string) => Promise<Vector>;
export type CustomBatchEmbedFn = (texts: string[]) => Promise<Vector[]>;

/**
 * Create a custom embedding function
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
 * Simple hash-based embedding for testing (NOT for production use)
 * Creates deterministic vectors from text for testing purposes
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
