/**
 * Built-in tools for AI agents to interact with Pocket collections.
 * Includes: queryCollection, insertDocument, countDocuments, semanticSearch, summarizeCollection.
 */
import type { AgentContext, Tool, ToolResult } from './types.js';

export type CollectionQueryFn = (
  collection: string,
  query: Record<string, unknown>
) => Promise<Record<string, unknown>[]>;
export type CollectionInsertFn = (
  collection: string,
  document: Record<string, unknown>
) => Promise<Record<string, unknown>>;
export type CollectionCountFn = (
  collection: string,
  filter?: Record<string, unknown>
) => Promise<number>;

export interface CollectionToolsConfig {
  queryFn: CollectionQueryFn;
  insertFn: CollectionInsertFn;
  countFn: CollectionCountFn;
  embeddingFn?: (text: string) => Promise<number[]>;
  summarizeFn?: (text: string) => Promise<string>;
}

function ok(data: unknown): ToolResult {
  return { success: true, data };
}

function fail(error: string): ToolResult {
  return { success: false, data: null, error };
}

/**
 * Creates built-in collection tools for AI agents.
 */
export function createCollectionTools(config: CollectionToolsConfig): Tool[] {
  const tools: Tool[] = [];

  // queryCollection – Query documents from a collection
  tools.push({
    name: 'queryCollection',
    description:
      'Query documents from a Pocket collection with optional filters, sorting, and limits.',
    parameters: [
      {
        name: 'collection',
        type: 'string',
        description: 'Collection name to query',
        required: true,
      },
      {
        name: 'filter',
        type: 'object',
        description: 'MongoDB-style filter object',
        required: false,
      },
      {
        name: 'sort',
        type: 'object',
        description: 'Sort object e.g. { "createdAt": -1 }',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Maximum number of results (default: 20)',
        required: false,
      },
      {
        name: 'fields',
        type: 'array',
        description: 'Fields to include in results',
        required: false,
      },
    ],
    execute: async (args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
      try {
        const collection = args.collection as string;
        if (!collection) return fail('Collection name is required');

        const query: Record<string, unknown> = {};
        if (args.filter) query.filter = args.filter;
        if (args.sort) query.sort = args.sort;
        if (args.limit) query.limit = args.limit;
        else query.limit = 20;

        const results = await config.queryFn(collection, query);

        // Apply field projection
        let projected = results;
        if (Array.isArray(args.fields) && args.fields.length > 0) {
          const fields = args.fields as string[];
          projected = results.map((doc) => {
            const filtered: Record<string, unknown> = {};
            for (const f of fields) {
              if (f in doc) filtered[f] = doc[f];
            }
            return filtered;
          });
        }

        return ok({ count: projected.length, documents: projected });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // insertDocument – Insert a document into a collection
  tools.push({
    name: 'insertDocument',
    description: 'Insert a new document into a Pocket collection.',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name', required: true },
      { name: 'document', type: 'object', description: 'Document to insert', required: true },
    ],
    execute: async (args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
      try {
        const collection = args.collection as string;
        const document = args.document as Record<string, unknown>;
        if (!collection || !document) {
          return fail('Collection and document are required');
        }
        const result = await config.insertFn(collection, document);
        return ok(result);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // countDocuments – Count documents in a collection
  tools.push({
    name: 'countDocuments',
    description: 'Count the number of documents in a Pocket collection, optionally with a filter.',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name', required: true },
      { name: 'filter', type: 'object', description: 'Optional filter', required: false },
    ],
    execute: async (args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
      try {
        const collection = args.collection as string;
        if (!collection) return fail('Collection name is required');
        const count = await config.countFn(
          collection,
          args.filter as Record<string, unknown> | undefined
        );
        return ok({ count });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  });

  // semanticSearch – Search by embedding similarity (if embedding function provided)
  if (config.embeddingFn) {
    const embeddingFn = config.embeddingFn;
    tools.push({
      name: 'semanticSearch',
      description: 'Search documents using natural language semantic similarity.',
      parameters: [
        { name: 'collection', type: 'string', description: 'Collection to search', required: true },
        {
          name: 'query',
          type: 'string',
          description: 'Natural language search query',
          required: true,
        },
        {
          name: 'limit',
          type: 'number',
          description: 'Max results (default: 10)',
          required: false,
        },
        {
          name: 'field',
          type: 'string',
          description: 'Text field to search (default: "content")',
          required: false,
        },
      ],
      execute: async (
        args: Record<string, unknown>,
        _context: AgentContext
      ): Promise<ToolResult> => {
        try {
          const collection = args.collection as string;
          const queryText = args.query as string;
          if (!collection || !queryText) {
            return fail('Collection and query are required');
          }

          const queryEmbedding = await embeddingFn(queryText);
          const limit = (args.limit as number) ?? 10;

          const docs = await config.queryFn(collection, { limit: 100 });
          const field = (args.field as string) ?? 'content';

          const scored = await Promise.all(
            docs.map(async (doc) => {
              const text = String(doc[field] ?? '');
              if (!text) return { doc, score: 0 };
              const docEmbedding = await embeddingFn(text);
              const score = cosineSimilarity(queryEmbedding, docEmbedding);
              return { doc, score };
            })
          );

          scored.sort((a, b) => b.score - a.score);
          const results = scored.slice(0, limit).map((s) => ({ ...s.doc, _score: s.score }));

          return ok({ results });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    });
  }

  // summarizeCollection – Get a summary of a collection's contents
  tools.push({
    name: 'summarizeCollection',
    description: 'Get a statistical summary of a Pocket collection.',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name', required: true },
      {
        name: 'sampleSize',
        type: 'number',
        description: 'Number of docs to sample (default: 10)',
        required: false,
      },
    ],
    execute: async (args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
      try {
        const collection = args.collection as string;
        if (!collection) return fail('Collection name is required');

        const sampleSize = (args.sampleSize as number) ?? 10;
        const count = await config.countFn(collection);
        const sample = await config.queryFn(collection, { limit: sampleSize });

        // Analyse schema from sample
        const fieldStats: Record<string, { types: Set<string>; nonNull: number }> = {};
        for (const doc of sample) {
          for (const [key, value] of Object.entries(doc)) {
            fieldStats[key] ??= { types: new Set(), nonNull: 0 };
            fieldStats[key].types.add(typeof value);
            if (value !== null && value !== undefined) fieldStats[key].nonNull++;
          }
        }

        const schema = Object.fromEntries(
          Object.entries(fieldStats).map(([key, stats]) => [
            key,
            {
              types: Array.from(stats.types),
              completeness: `${Math.round((stats.nonNull / sample.length) * 100)}%`,
            },
          ])
        );

        return ok({
          collection,
          totalDocuments: count,
          sampleSize: sample.length,
          schema,
          sample: sample.slice(0, 3),
        });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  });

  return tools;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
