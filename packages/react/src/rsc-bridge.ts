/**
 * RSCBridge — React Server Components integration for Pocket.
 *
 * Provides server-side query execution, client hydration bridge,
 * and Suspense-compatible data loading for Next.js App Router.
 */

// ── Types ──────────────────────────────────────────────────

export interface ServerPocketConfig {
  /** Database name for server queries */
  databaseName: string;
  /** Collections to pre-load */
  collections?: string[];
  /** Cache strategy */
  cache?: 'no-store' | 'force-cache' | 'default';
  /** Revalidation interval in seconds */
  revalidate?: number;
}

export interface ServerQueryResult<T = Record<string, unknown>> {
  data: T[];
  meta: {
    collection: string;
    fetchedAt: number;
    count: number;
    cached: boolean;
    revalidateAt: number | null;
  };
}

export interface HydrationPayload {
  queries: {
    collection: string;
    filter: Record<string, unknown>;
    data: Record<string, unknown>[];
    fetchedAt: number;
  }[];
  databaseName: string;
  version: string;
}

export interface SuspenseConfig {
  /** Fallback key for deduplication */
  queryKey: string;
  /** Timeout before showing fallback (ms) */
  timeoutMs?: number;
}

/** Minimal server-side data source */
export interface ServerDatabase {
  name: string;
  query<T extends Record<string, unknown>>(
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: Record<string, 'asc' | 'desc'>; limit?: number }
  ): Promise<T[]>;
}

// ── Server Query ──────────────────────────────────────────

/**
 * Execute a server-side Pocket query for RSC.
 */
export async function serverQuery<T extends Record<string, unknown>>(
  db: ServerDatabase,
  collection: string,
  filter?: Record<string, unknown>,
  options?: { sort?: Record<string, 'asc' | 'desc'>; limit?: number; revalidate?: number }
): Promise<ServerQueryResult<T>> {
  const data = await db.query<T>(collection, filter, options);
  const now = Date.now();

  return {
    data,
    meta: {
      collection,
      fetchedAt: now,
      count: data.length,
      cached: false,
      revalidateAt: options?.revalidate ? now + options.revalidate * 1000 : null,
    },
  };
}

/**
 * Create a hydration payload from server query results.
 */
export function createHydrationPayload(
  databaseName: string,
  results: {
    collection: string;
    filter: Record<string, unknown>;
    data: Record<string, unknown>[];
  }[]
): HydrationPayload {
  return {
    queries: results.map((r) => ({
      collection: r.collection,
      filter: r.filter,
      data: r.data,
      fetchedAt: Date.now(),
    })),
    databaseName,
    version: '1.0',
  };
}

/**
 * Validate a hydration payload from the server.
 */
export function validateHydrationPayload(payload: unknown): payload is HydrationPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.databaseName === 'string' &&
    typeof p.version === 'string' &&
    Array.isArray(p.queries) &&
    p.queries.every((q: unknown) => {
      const query = q as Record<string, unknown>;
      return typeof query.collection === 'string' && Array.isArray(query.data);
    })
  );
}

/**
 * Create a Suspense-compatible resource for Pocket queries.
 */
export function createSuspenseResource<T>(
  fetcher: () => Promise<T>,
  config: SuspenseConfig
): { read(): T } {
  let status: 'pending' | 'resolved' | 'rejected' = 'pending';
  let result: T;
  let error: unknown;

  const promise = fetcher().then(
    (data) => {
      status = 'resolved';
      result = data;
    },
    (err: unknown) => {
      status = 'rejected';
      error = err;
    }
  );

  void config; // queryKey used for deduplication in a real implementation

  return {
    read(): T {
      switch (status) {
        case 'pending':
          throw promise as unknown as Error;
        case 'rejected':
          throw error;
        case 'resolved':
          return result;
      }
    },
  };
}

/**
 * Create a server-side Pocket instance factory.
 */
export function createServerPocket(config: ServerPocketConfig): {
  config: ServerPocketConfig;
  query: <T extends Record<string, unknown>>(
    db: ServerDatabase,
    collection: string,
    filter?: Record<string, unknown>,
    options?: { sort?: Record<string, 'asc' | 'desc'>; limit?: number }
  ) => Promise<ServerQueryResult<T>>;
} {
  return {
    config,
    query: <T extends Record<string, unknown>>(
      db: ServerDatabase,
      collection: string,
      filter?: Record<string, unknown>,
      options?: { sort?: Record<string, 'asc' | 'desc'>; limit?: number }
    ) => serverQuery<T>(db, collection, filter, { ...options, revalidate: config.revalidate }),
  };
}
