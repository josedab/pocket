/**
 * DevToolsBridge - Bridge between Pocket Studio and browser DevTools.
 *
 * Provides a global API that can be accessed from Chrome DevTools
 * extensions or the browser console for database inspection.
 */

import type { Database } from '@pocket/core';
import type { StudioEvent } from './types.js';
import { Subject, takeUntil, type Observable } from 'rxjs';
import { DatabaseInspector } from './database-inspector.js';
import { QueryPlayground } from './query-playground.js';
import { PerformanceProfiler } from './performance-profiler.js';

export interface DevToolsAPI {
  /** Inspect database collections */
  inspect: () => Promise<DevToolsSnapshot>;
  /** Query a collection */
  query: (collection: string, filter?: Record<string, unknown>) => Promise<unknown[]>;
  /** Get a document by ID */
  getDocument: (collection: string, id: string) => Promise<unknown | null>;
  /** Get collection names */
  getCollections: () => Promise<string[]>;
  /** Get performance stats */
  getPerformance: () => DevToolsPerformanceStats;
  /** Get query history */
  getQueryHistory: () => DevToolsQueryHistoryEntry[];
  /** Execute a natural language query description */
  describe: (queryDescription: string) => string;
  /** Get version info */
  version: () => string;
}

export interface DevToolsSnapshot {
  name: string;
  collections: {
    name: string;
    documentCount: number;
    sampleDocuments: unknown[];
  }[];
  timestamp: number;
}

export interface DevToolsPerformanceStats {
  operationCount: number;
  avgLatencyMs: number;
  slowOperations: number;
}

export interface DevToolsQueryHistoryEntry {
  collection: string;
  filter: Record<string, unknown>;
  durationMs: number;
  resultCount: number;
  executedAt: number;
}

export interface DevToolsBridgeConfig {
  /** Global variable name for the DevTools API. @default '__POCKET_DEVTOOLS__' */
  globalName?: string;
  /** Whether to auto-attach on creation. @default true */
  autoAttach?: boolean;
  /** Maximum sample documents per collection in snapshots */
  maxSampleDocs?: number;
}

export class DevToolsBridge {
  private readonly db: Database;
  private readonly config: Required<DevToolsBridgeConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly events$ = new Subject<StudioEvent>();
  private readonly inspector: DatabaseInspector;
  private readonly playground: QueryPlayground;
  private readonly profiler: PerformanceProfiler;
  private isAttached = false;

  constructor(db: Database, config: DevToolsBridgeConfig = {}) {
    this.db = db;
    this.config = {
      globalName: config.globalName ?? '__POCKET_DEVTOOLS__',
      autoAttach: config.autoAttach ?? true,
      maxSampleDocs: config.maxSampleDocs ?? 5,
    };

    this.inspector = new DatabaseInspector(db);
    this.playground = new QueryPlayground(db);
    this.profiler = new PerformanceProfiler(db);

    if (this.config.autoAttach) {
      this.attach();
    }
  }

  /**
   * Attach the DevTools API to the global scope.
   */
  attach(): void {
    if (this.isAttached) return;

    const api = this.createAPI();

    if (typeof globalThis !== 'undefined') {
      (globalThis as Record<string, unknown>)[this.config.globalName] = api;
      this.isAttached = true;

      this.events$.next({
        type: 'devtools:attached',
        globalName: this.config.globalName,
      });
    }
  }

  /**
   * Detach the DevTools API from the global scope.
   */
  detach(): void {
    if (!this.isAttached) return;

    if (typeof globalThis !== 'undefined') {
      delete (globalThis as Record<string, unknown>)[this.config.globalName];
      this.isAttached = false;
    }
  }

  /**
   * Get whether the bridge is currently attached.
   */
  getIsAttached(): boolean {
    return this.isAttached;
  }

  /**
   * Get events from the bridge.
   */
  getEvents(): Observable<StudioEvent> {
    return this.events$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Get the underlying QueryPlayground.
   */
  getPlayground(): QueryPlayground {
    return this.playground;
  }

  /**
   * Get the underlying PerformanceProfiler.
   */
  getProfiler(): PerformanceProfiler {
    return this.profiler;
  }

  /**
   * Destroy the bridge and clean up resources.
   */
  destroy(): void {
    this.detach();
    this.playground.destroy();
    this.destroy$.next();
    this.destroy$.complete();
    this.events$.complete();
  }

  private createAPI(): DevToolsAPI {
    return {
      inspect: async () => this.createSnapshot(),

      query: async (collection: string, filter?: Record<string, unknown>) => {
        const result = await this.playground.executeQuery({ collection, filter });
        return result.results;
      },

      getDocument: async (collection: string, id: string) => {
        return this.inspector.getDocument(collection, id);
      },

      getCollections: async () => {
        const info = await this.inspector.listCollections();
        return info.map((c) => c.name);
      },

      getPerformance: () => {
        const stats = this.profiler.getOperationStats();
        const totalOps = stats.reads + stats.writes;
        const avgLatency =
          totalOps > 0
            ? (stats.avgReadMs * stats.reads + stats.avgWriteMs * stats.writes) / totalOps
            : 0;
        return {
          operationCount: totalOps,
          avgLatencyMs: Math.round(avgLatency * 100) / 100,
          slowOperations: this.profiler.getSlowQueries().length,
        };
      },

      getQueryHistory: () => {
        return this.playground
          .getSlowQueries(0)
          .slice(0, 50)
          .map((e) => ({
            collection: e.collection,
            filter: e.filter,
            durationMs: e.durationMs,
            resultCount: e.resultCount,
            executedAt: e.executedAt,
          }));
      },

      describe: (queryDescription: string) => {
        return `Query: ${queryDescription} (use @pocket/ai SmartQueryEngine for NL→query translation)`;
      },

      version: () => '0.1.0',
    };
  }

  private async createSnapshot(): Promise<DevToolsSnapshot> {
    const collections = await this.inspector.listCollections();
    const collectionData = await Promise.all(
      collections.map(async (c) => {
        let sampleDocs: unknown[] = [];
        try {
          const result = await this.inspector.queryDocuments(
            c.name,
            undefined,
            undefined,
            this.config.maxSampleDocs
          );
          sampleDocs = result.documents;
        } catch {
          // Collection may be empty or have issues
        }
        return {
          name: c.name,
          documentCount: c.documentCount,
          sampleDocuments: sampleDocs,
        };
      })
    );

    return {
      name: this.db.name,
      collections: collectionData,
      timestamp: Date.now(),
    };
  }
}

/**
 * Create a new DevToolsBridge instance.
 *
 * @param db - The Pocket Database instance
 * @param config - Optional bridge configuration
 * @returns A new DevToolsBridge
 *
 * @example
 * ```typescript
 * import { createDevToolsBridge } from '@pocket/studio';
 *
 * const bridge = createDevToolsBridge(db, { globalName: '__MY_APP__' });
 * // API is now available at globalThis.__MY_APP__
 * ```
 */
export function createDevToolsBridge(db: Database, config?: DevToolsBridgeConfig): DevToolsBridge {
  return new DevToolsBridge(db, config);
}
