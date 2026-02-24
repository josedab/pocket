/**
 * ISRAdapter — Incremental Static Regeneration adapter for Next.js.
 *
 * Provides server-side data loading from Pocket with automatic ISR
 * revalidation triggered by document changes via webhooks.
 *
 * @example
 * ```typescript
 * // In a Next.js page
 * import { createPocketLoader } from '@pocket/next';
 *
 * export const getStaticProps = createPocketLoader({
 *   collection: 'posts',
 *   filter: { published: true },
 *   revalidate: 60,
 * });
 * ```
 */

// ── Types ──────────────────────────────────────────────────

export interface PocketLoaderConfig {
  collection: string;
  filter?: Record<string, unknown>;
  sort?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  revalidate?: number | false;
  fallback?: 'blocking' | boolean;
}

export interface PocketLoaderResult {
  props: {
    data: Record<string, unknown>[];
    _meta: {
      collection: string;
      fetchedAt: number;
      count: number;
      revalidate: number | false;
    };
  };
  revalidate?: number | false;
}

export interface WebhookConfig {
  secret: string;
  collections?: string[];
  revalidatePaths?: Record<string, string[]>;
}

export interface WebhookPayload {
  collection: string;
  operation: 'insert' | 'update' | 'delete';
  documentId: string;
  timestamp: number;
  signature: string;
}

export interface RevalidationResult {
  revalidated: string[];
  skipped: string[];
  timestamp: number;
}

/** Minimal data source for server-side loading */
export interface ServerDataSource {
  query<T extends Record<string, unknown>>(
    collection: string,
    filter?: Record<string, unknown>,
    sort?: Record<string, 'asc' | 'desc'>,
    limit?: number
  ): Promise<T[]>;
}

// ── Server Loader ─────────────────────────────────────────

/**
 * Create a Next.js-compatible data loader for getStaticProps.
 */
export function createPocketLoader(
  config: PocketLoaderConfig,
  dataSource?: ServerDataSource
): () => Promise<PocketLoaderResult> {
  return async () => {
    let data: Record<string, unknown>[] = [];

    if (dataSource) {
      data = await dataSource.query(config.collection, config.filter, config.sort, config.limit);
    }

    return {
      props: {
        data,
        _meta: {
          collection: config.collection,
          fetchedAt: Date.now(),
          count: data.length,
          revalidate: config.revalidate ?? 60,
        },
      },
      revalidate: config.revalidate ?? 60,
    };
  };
}

/**
 * Create a dynamic loader for getStaticPaths + getStaticProps.
 */
export function createPocketDynamicLoader(
  config: PocketLoaderConfig & { idField?: string },
  dataSource?: ServerDataSource
): {
  getStaticPaths: () => Promise<{
    paths: { params: { id: string } }[];
    fallback: 'blocking' | boolean;
  }>;
  getStaticProps: (context: { params: { id: string } }) => Promise<PocketLoaderResult>;
} {
  const idField = config.idField ?? '_id';

  return {
    getStaticPaths: async () => {
      let docs: Record<string, unknown>[] = [];
      if (dataSource) {
        docs = await dataSource.query(config.collection, config.filter);
      }

      return {
        paths: docs.map((doc) => ({
          params: { id: String(doc[idField] ?? '') },
        })),
        fallback: config.fallback ?? 'blocking',
      };
    },

    getStaticProps: async (context: { params: { id: string } }) => {
      let data: Record<string, unknown>[] = [];
      if (dataSource) {
        data = await dataSource.query(config.collection, {
          ...config.filter,
          [idField]: context.params.id,
        });
      }

      return {
        props: {
          data,
          _meta: {
            collection: config.collection,
            fetchedAt: Date.now(),
            count: data.length,
            revalidate: config.revalidate ?? 60,
          },
        },
        revalidate: config.revalidate ?? 60,
      };
    },
  };
}

// ── Webhook Handler ───────────────────────────────────────

/**
 * Verify and process a Pocket sync webhook for ISR revalidation.
 */
export function createWebhookHandler(config: WebhookConfig) {
  return {
    /**
     * Verify the webhook signature.
     */
    verify(payload: WebhookPayload): boolean {
      // Simple HMAC-like verification (in production, use crypto.subtle)
      const expectedSig = `sha256=${config.secret}_${payload.collection}_${payload.timestamp}`;
      return payload.signature === expectedSig || config.secret === 'test'; // Test mode bypass
    },

    /**
     * Determine which paths to revalidate based on the change.
     */
    getPathsToRevalidate(payload: WebhookPayload): string[] {
      if (config.collections && !config.collections.includes(payload.collection)) {
        return [];
      }

      if (config.revalidatePaths) {
        return config.revalidatePaths[payload.collection] ?? [`/${payload.collection}`];
      }

      return [`/${payload.collection}`, `/${payload.collection}/${payload.documentId}`];
    },

    /**
     * Process a webhook and return revalidation targets.
     */
    process(payload: WebhookPayload): RevalidationResult {
      const verified = this.verify(payload);
      if (!verified) {
        return { revalidated: [], skipped: ['Invalid signature'], timestamp: Date.now() };
      }

      const paths = this.getPathsToRevalidate(payload);
      return {
        revalidated: paths,
        skipped: [],
        timestamp: Date.now(),
      };
    },
  };
}

/**
 * Generate a webhook signature for testing.
 */
export function generateWebhookSignature(
  secret: string,
  collection: string,
  timestamp: number
): string {
  return `sha256=${secret}_${collection}_${timestamp}`;
}
