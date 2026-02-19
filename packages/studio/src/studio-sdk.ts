/**
 * StudioSDK - Unified Visual Database Studio entry point.
 *
 * Provides a high-level facade that wires together DatabaseInspector,
 * QueryPlayground, and DocumentEditor into a single cohesive API.
 *
 * @example
 * ```typescript
 * import { createStudioSDK } from '@pocket/studio';
 * import { Database } from '@pocket/core';
 *
 * const db = await Database.create({ name: 'my-app', storage });
 * const sdk = createStudioSDK({ database: db, enableQueryPlayground: true });
 *
 * await sdk.start();
 * const result = await sdk.inspectCollection('users');
 * await sdk.stop();
 * ```
 *
 * @see {@link createStudioSDK} for the factory function
 */

import type { Database, Document } from '@pocket/core';
import { BehaviorSubject, type Observable } from 'rxjs';
import { DatabaseInspector, createDatabaseInspector } from './database-inspector.js';
import { DocumentEditor, createDocumentEditor } from './document-editor.js';
import { QueryPlayground, createQueryPlayground } from './query-playground.js';
import type { CollectionInfo } from './types.js';

/** Status of the StudioSDK lifecycle. */
export type StudioStatus = 'stopped' | 'running';

/** Configuration for creating a StudioSDK instance. */
export interface StudioSDKConfig {
  /** Pocket Database instance to operate on */
  database: Database;
  /** Collection names to scope operations to (all if omitted) */
  collections?: string[];
  /** Enable the query playground component. @default true */
  enableQueryPlayground?: boolean;
  /** Enable the document editor component. @default true */
  enableDocEditor?: boolean;
  /** Enable the performance profiler component. @default false */
  enableProfiler?: boolean;
}

/** Result of inspecting a collection. */
export interface InspectionResult {
  /** Collection metadata */
  collection: CollectionInfo;
  /** Whether the inspection was filtered by configured collections */
  filtered: boolean;
}

/** Result of executing a query through the SDK. */
export interface QueryExecutionResult {
  /** Documents matching the query */
  documents: unknown[];
  /** Number of documents returned */
  count: number;
  /** Execution duration in milliseconds */
  durationMs: number;
}

export class StudioSDK {
  private readonly db: Database;
  private readonly config: Required<Omit<StudioSDKConfig, 'database'>>;
  private readonly status$ = new BehaviorSubject<StudioStatus>('stopped');

  private inspector: DatabaseInspector | undefined;
  private playground: QueryPlayground | undefined;
  private docEditor: DocumentEditor | undefined;

  constructor(config: StudioSDKConfig) {
    this.db = config.database;
    this.config = {
      collections: config.collections ?? [],
      enableQueryPlayground: config.enableQueryPlayground ?? true,
      enableDocEditor: config.enableDocEditor ?? true,
      enableProfiler: config.enableProfiler ?? false,
    };
  }

  /**
   * Start the SDK, initialising internal components.
   */
  async start(): Promise<void> {
    if (this.status$.getValue() === 'running') {
      return;
    }

    this.inspector = createDatabaseInspector(this.db);

    if (this.config.enableQueryPlayground) {
      this.playground = createQueryPlayground(this.db);
    }

    if (this.config.enableDocEditor) {
      this.docEditor = createDocumentEditor(this.db);
    }

    this.status$.next('running');
  }

  /**
   * Stop the SDK and release resources.
   */
  async stop(): Promise<void> {
    if (this.status$.getValue() === 'stopped') {
      return;
    }

    this.inspector = undefined;
    this.playground = undefined;
    this.docEditor = undefined;
    this.status$.next('stopped');
    this.status$.complete();
  }

  /**
   * Inspect a single collection by name.
   *
   * @param name - Collection name to inspect
   * @returns Inspection result with collection metadata
   */
  async inspectCollection(name: string): Promise<InspectionResult> {
    this.ensureRunning();

    const filtered =
      this.config.collections.length > 0 &&
      !this.config.collections.includes(name);

    const collection = await this.inspector!.getCollection(name);

    return { collection, filtered };
  }

  /**
   * Execute a query against a collection.
   *
   * @param collection - Target collection name
   * @param query - Filter object for the query
   * @returns Query execution result with matching documents
   */
  async executeQuery(
    collection: string,
    query: Record<string, unknown>
  ): Promise<QueryExecutionResult> {
    this.ensureRunning();

    if (!this.playground) {
      throw new Error('QueryPlayground is not enabled');
    }

    const startTime = Date.now();
    const { results } = await this.playground.executeQuery({
      collection,
      filter: query,
    });
    const durationMs = Date.now() - startTime;

    return {
      documents: results,
      count: results.length,
      durationMs,
    };
  }

  /**
   * Retrieve a single document by ID from a collection.
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @returns The document, or null if not found
   */
  async getDocument(
    collection: string,
    id: string
  ): Promise<Document | null> {
    this.ensureRunning();

    const result = await this.inspector!.getDocument(collection, id);
    return result as Document | null;
  }

  /**
   * Get the current SDK status.
   */
  getStatus(): StudioStatus {
    return this.status$.getValue();
  }

  /**
   * Observable stream of status changes.
   */
  get status(): Observable<StudioStatus> {
    return this.status$.asObservable();
  }

  /**
   * Whether the document editor component is available.
   */
  get hasDocEditor(): boolean {
    return this.docEditor !== undefined;
  }

  private ensureRunning(): void {
    if (this.status$.getValue() !== 'running') {
      throw new Error('StudioSDK is not running. Call start() first.');
    }
  }
}

/**
 * Factory function to create a StudioSDK instance.
 *
 * @example
 * ```typescript
 * import { createStudioSDK } from '@pocket/studio';
 *
 * const sdk = createStudioSDK({ database: db });
 * await sdk.start();
 * ```
 *
 * @param config - SDK configuration
 * @returns A new StudioSDK instance
 */
export function createStudioSDK(config: StudioSDKConfig): StudioSDK {
  return new StudioSDK(config);
}
