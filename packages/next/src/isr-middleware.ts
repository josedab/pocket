/**
 * ISR App Router Middleware — automatic revalidation for Next.js
 * App Router based on Pocket sync events.
 *
 * Intercepts requests and manages revalidation state, cache tags,
 * and on-demand ISR triggers from database changes.
 */

/** Cache tag for a collection. */
export type CacheTag = `pocket:${string}`;

/** Middleware configuration. */
export interface ISRMiddlewareConfig {
  /** Collections to auto-revalidate. */
  readonly collections: readonly string[];
  /** Path patterns mapped to collections they depend on. */
  readonly pathDependencies: Record<string, readonly string[]>;
  /** Default revalidation interval in seconds. */
  readonly defaultRevalidate?: number;
  /** Secret for webhook-triggered revalidation. */
  readonly revalidationSecret?: string;
}

/** A revalidation event from the sync engine. */
export interface SyncRevalidationEvent {
  readonly collection: string;
  readonly documentId?: string;
  readonly operation: 'insert' | 'update' | 'delete';
  readonly timestamp: number;
}

/** Result of middleware processing a request. */
export interface MiddlewareResult {
  readonly action: 'pass' | 'revalidate' | 'cache-hit';
  readonly cacheTags: readonly CacheTag[];
  readonly revalidatedPaths: readonly string[];
  readonly headers: Record<string, string>;
}

/** Generate a cache tag for a collection. */
export function collectionCacheTag(collection: string): CacheTag {
  return `pocket:${collection}`;
}

/** Generate cache tags for a document. */
export function documentCacheTag(collection: string, documentId: string): CacheTag {
  return `pocket:${collection}:${documentId}`;
}

/**
 * ISR Middleware — manages revalidation state and processes
 * sync events into cache invalidation actions.
 */
export class ISRMiddleware {
  private readonly config: Required<ISRMiddlewareConfig>;
  private readonly pendingRevalidations = new Set<string>();
  private readonly revalidationLog: {
    path: string;
    collection: string;
    timestamp: number;
  }[] = [];

  constructor(config: ISRMiddlewareConfig) {
    this.config = {
      collections: config.collections,
      pathDependencies: config.pathDependencies,
      defaultRevalidate: config.defaultRevalidate ?? 60,
      revalidationSecret: config.revalidationSecret ?? '',
    };
  }

  /**
   * Process a sync event and determine which paths need revalidation.
   */
  processSyncEvent(event: SyncRevalidationEvent): MiddlewareResult {
    const affectedPaths: string[] = [];

    // Find all paths that depend on the changed collection
    for (const [path, deps] of Object.entries(this.config.pathDependencies)) {
      if (deps.includes(event.collection)) {
        affectedPaths.push(path);
        this.pendingRevalidations.add(path);
        this.revalidationLog.push({
          path,
          collection: event.collection,
          timestamp: event.timestamp,
        });
      }
    }

    const cacheTags: CacheTag[] = [collectionCacheTag(event.collection)];
    if (event.documentId) {
      cacheTags.push(documentCacheTag(event.collection, event.documentId));
    }

    return {
      action: affectedPaths.length > 0 ? 'revalidate' : 'pass',
      cacheTags,
      revalidatedPaths: affectedPaths,
      headers: {
        'x-pocket-revalidated': affectedPaths.length > 0 ? 'true' : 'false',
        'x-pocket-collection': event.collection,
        'cache-control': `s-maxage=${this.config.defaultRevalidate}, stale-while-revalidate`,
      },
    };
  }

  /**
   * Process a request path and return appropriate caching headers.
   */
  processRequest(path: string): MiddlewareResult {
    const deps = this.config.pathDependencies[path];
    if (!deps) {
      return {
        action: 'pass',
        cacheTags: [],
        revalidatedPaths: [],
        headers: {},
      };
    }

    const cacheTags = deps.map((c) => collectionCacheTag(c));
    const needsRevalidation = this.pendingRevalidations.has(path);

    if (needsRevalidation) {
      this.pendingRevalidations.delete(path);
    }

    return {
      action: needsRevalidation ? 'revalidate' : 'cache-hit',
      cacheTags,
      revalidatedPaths: needsRevalidation ? [path] : [],
      headers: {
        'cache-control': `s-maxage=${this.config.defaultRevalidate}, stale-while-revalidate`,
        'x-pocket-cache-tags': cacheTags.join(','),
      },
    };
  }

  /**
   * Generate Next.js middleware response headers for a path.
   */
  getResponseHeaders(path: string): Record<string, string> {
    const result = this.processRequest(path);
    return result.headers;
  }

  /**
   * Get all paths that are pending revalidation.
   */
  getPendingRevalidations(): readonly string[] {
    return Array.from(this.pendingRevalidations);
  }

  /**
   * Get the revalidation log for debugging.
   */
  getRevalidationLog(): readonly { path: string; collection: string; timestamp: number }[] {
    return [...this.revalidationLog];
  }

  /**
   * Clear all pending revalidations and log.
   */
  reset(): void {
    this.pendingRevalidations.clear();
    this.revalidationLog.length = 0;
  }

  /**
   * Generate a Next.js middleware.ts matcher config.
   */
  getMatcherConfig(): { matcher: string[] } {
    return {
      matcher: Object.keys(this.config.pathDependencies).map((p) =>
        p.includes(':') ? p.replace(/:(\w+)/g, ':$1*') : p
      ),
    };
  }
}

export function createISRMiddleware(config: ISRMiddlewareConfig): ISRMiddleware {
  return new ISRMiddleware(config);
}
