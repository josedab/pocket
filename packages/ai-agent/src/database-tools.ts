/**
 * @module database-tools
 *
 * Built-in database tools that allow the AI agent to query,
 * insert, update, and analyze data in Pocket collections.
 */

import type { AgentContext, Tool, ToolResult } from './types.js';

/**
 * Interface representing a minimal Pocket database for tool operations.
 */
export interface DatabaseAdapter {
  /** List available collection names */
  getCollectionNames(): readonly string[];
  /** Query documents from a collection */
  query(collection: string, filter?: Record<string, unknown>): Promise<unknown[]>;
  /** Get a single document by ID */
  get(collection: string, id: string): Promise<unknown | null>;
  /** Insert a document */
  insert(collection: string, doc: Record<string, unknown>): Promise<unknown>;
  /** Update a document */
  update(collection: string, id: string, changes: Record<string, unknown>): Promise<unknown>;
  /** Count documents matching a filter */
  count(collection: string, filter?: Record<string, unknown>): Promise<number>;
  /** Delete a document */
  delete(collection: string, id: string): Promise<void>;
}

function createResult(success: boolean, data: unknown, error?: string): ToolResult {
  return { success, data, error };
}

function createQueryTool(db: DatabaseAdapter): Tool {
  return {
    name: 'query_documents',
    description: 'Query documents from a database collection with optional filters. Returns matching documents.',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name to query', required: true },
      { name: 'filter', type: 'object', description: 'Filter criteria as key-value pairs', required: false },
      { name: 'limit', type: 'number', description: 'Maximum documents to return', required: false },
    ],
    async execute(args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> {
      try {
        const collection = args.collection as string;
        if (!collection) return createResult(false, null, 'Collection name is required');

        const filter = args.filter as Record<string, unknown> | undefined;
        let results = await db.query(collection, filter);

        const limit = args.limit as number | undefined;
        if (limit && limit > 0) {
          results = results.slice(0, limit);
        }

        return createResult(true, { documents: results, count: results.length });
      } catch (err) {
        return createResult(false, null, err instanceof Error ? err.message : 'Query failed');
      }
    },
  };
}

function createGetDocumentTool(db: DatabaseAdapter): Tool {
  return {
    name: 'get_document',
    description: 'Get a single document by its ID from a collection.',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name', required: true },
      { name: 'id', type: 'string', description: 'Document ID', required: true },
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const doc = await db.get(args.collection as string, args.id as string);
        return doc
          ? createResult(true, doc)
          : createResult(false, null, 'Document not found');
      } catch (err) {
        return createResult(false, null, err instanceof Error ? err.message : 'Get failed');
      }
    },
  };
}

function createInsertTool(db: DatabaseAdapter): Tool {
  return {
    name: 'insert_document',
    description: 'Insert a new document into a collection.',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name', required: true },
      { name: 'document', type: 'object', description: 'Document data to insert', required: true },
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const result = await db.insert(
          args.collection as string,
          args.document as Record<string, unknown>,
        );
        return createResult(true, result);
      } catch (err) {
        return createResult(false, null, err instanceof Error ? err.message : 'Insert failed');
      }
    },
  };
}

function createCountTool(db: DatabaseAdapter): Tool {
  return {
    name: 'count_documents',
    description: 'Count documents in a collection matching optional filter criteria.',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name', required: true },
      { name: 'filter', type: 'object', description: 'Filter criteria', required: false },
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const count = await db.count(
          args.collection as string,
          args.filter as Record<string, unknown> | undefined,
        );
        return createResult(true, { count });
      } catch (err) {
        return createResult(false, null, err instanceof Error ? err.message : 'Count failed');
      }
    },
  };
}

function createListCollectionsTool(db: DatabaseAdapter): Tool {
  return {
    name: 'list_collections',
    description: 'List all available collection names in the database.',
    parameters: [],
    async execute(): Promise<ToolResult> {
      try {
        const names = db.getCollectionNames();
        return createResult(true, { collections: names });
      } catch (err) {
        return createResult(false, null, err instanceof Error ? err.message : 'List failed');
      }
    },
  };
}

function createSummarizeTool(db: DatabaseAdapter): Tool {
  return {
    name: 'summarize_collection',
    description: 'Get summary statistics for a collection (count, sample documents).',
    parameters: [
      { name: 'collection', type: 'string', description: 'Collection name', required: true },
    ],
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      try {
        const collection = args.collection as string;
        const count = await db.count(collection);
        const sample = await db.query(collection);
        const sampleDocs = sample.slice(0, 3);

        return createResult(true, { collection, totalCount: count, sampleDocuments: sampleDocs });
      } catch (err) {
        return createResult(false, null, err instanceof Error ? err.message : 'Summarize failed');
      }
    },
  };
}

/**
 * Creates a set of database tools for AI agent use.
 *
 * @param db - Database adapter providing access to Pocket collections
 * @returns Array of tools the agent can use to interact with the database
 *
 * @example
 * ```typescript
 * const tools = createDatabaseTools(myDbAdapter);
 * const agent = createAgent({ tools, provider: myLLM });
 * ```
 */
export function createDatabaseTools(db: DatabaseAdapter): readonly Tool[] {
  return [
    createQueryTool(db),
    createGetDocumentTool(db),
    createInsertTool(db),
    createCountTool(db),
    createListCollectionsTool(db),
    createSummarizeTool(db),
  ];
}
