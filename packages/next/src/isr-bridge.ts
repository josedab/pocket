/**
 * ISR Bridge — Incremental Static Regeneration adapter for Next.js.
 *
 * Pre-renders pages from Pocket data at build time, then hydrates
 * with live local-first queries for SEO + offline in one API.
 */

/** Configuration for server-side data fetching. */
export interface ISRConfig {
  /** Collections to pre-render from. */
  readonly collections: readonly string[];
  /** Default revalidation interval in seconds. */
  readonly revalidateSeconds?: number;
  /** Whether to enable on-demand revalidation via webhook. */
  readonly onDemandRevalidation?: boolean;
  /** Secret for webhook signature verification. */
  readonly revalidationSecret?: string;
}

/** A pre-rendered data payload for hydration. */
export interface HydrationPayload<T = Record<string, unknown>> {
  readonly collection: string;
  readonly documents: readonly T[];
  readonly query?: Record<string, unknown>;
  readonly fetchedAt: number;
  readonly revalidateAfter?: number;
  readonly stale: boolean;
}

/** Next.js static props result shape. */
export interface PocketStaticProps {
  readonly props: {
    readonly _pocketHydration: readonly HydrationPayload[];
  };
  readonly revalidate?: number;
}

/** Revalidation webhook request. */
export interface RevalidationRequest {
  readonly collection: string;
  readonly documentId?: string;
  readonly timestamp: number;
  readonly signature: string;
}

/** Revalidation result. */
export interface ISRRevalidationResult {
  readonly revalidated: boolean;
  readonly paths: readonly string[];
  readonly error?: string;
}

/** Data source for fetching from server during build. */
export interface ISRDataSource {
  fetchCollection<T>(collection: string, query?: Record<string, unknown>): Promise<readonly T[]>;
}

/**
 * Create a getStaticProps-compatible function that pre-fetches
 * Pocket data for server-side rendering.
 */
export function createStaticPropsFactory(dataSource: ISRDataSource, config: ISRConfig) {
  return async function getPocketStaticProps(
    queries: readonly {
      collection: string;
      query?: Record<string, unknown>;
    }[]
  ): Promise<PocketStaticProps> {
    const hydration: HydrationPayload[] = [];
    const now = Date.now();
    const revalidateMs = (config.revalidateSeconds ?? 60) * 1000;

    for (const q of queries) {
      const documents = await dataSource.fetchCollection(q.collection, q.query);

      hydration.push({
        collection: q.collection,
        documents: documents as readonly Record<string, unknown>[],
        query: q.query,
        fetchedAt: now,
        revalidateAfter: now + revalidateMs,
        stale: false,
      });
    }

    return {
      props: { _pocketHydration: hydration },
      revalidate: config.revalidateSeconds,
    };
  };
}

/**
 * Hydration bridge — determines whether to use pre-rendered data
 * or switch to live local-first queries.
 */
export class HydrationBridge {
  private readonly payloads = new Map<string, HydrationPayload>();
  private hydrated = false;

  /** Load pre-rendered data from server props. */
  loadServerData(payloads: readonly HydrationPayload[]): void {
    for (const payload of payloads) {
      this.payloads.set(payload.collection, payload);
    }
  }

  /** Get pre-rendered data for a collection, marking as stale if expired. */
  getHydrationData<T>(collection: string): HydrationPayload<T> | null {
    const payload = this.payloads.get(collection);
    if (!payload) return null;

    const now = Date.now();
    if (payload.revalidateAfter && now > payload.revalidateAfter) {
      const stalePayload = { ...payload, stale: true };
      this.payloads.set(collection, stalePayload);
      return stalePayload as HydrationPayload<T>;
    }

    return payload as HydrationPayload<T>;
  }

  /** Check if hydration data is available and fresh. */
  isHydrated(collection: string): boolean {
    const payload = this.payloads.get(collection);
    return !!payload && !payload.stale;
  }

  /** Mark that the client has transitioned to live queries. */
  markLive(): void {
    this.hydrated = true;
  }

  /** Whether we've transitioned to live queries. */
  get isLive(): boolean {
    return this.hydrated;
  }

  /** Get all loaded collection names. */
  getCollections(): readonly string[] {
    return Array.from(this.payloads.keys());
  }
}

/**
 * Verify a revalidation webhook signature.
 */
export function verifyRevalidationSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // HMAC-SHA256 verification (simplified — uses string comparison)
  // In production, use crypto.subtle.sign
  const expected = simpleHash(`${payload}:${secret}`);
  return signature === expected;
}

/**
 * Create a revalidation webhook handler.
 */
export function createRevalidationHandler(
  secret: string,
  revalidatePath: (path: string) => Promise<void>
) {
  return async function handleRevalidation(
    request: RevalidationRequest,
    pathMapping: Record<string, readonly string[]>
  ): Promise<ISRRevalidationResult> {
    // Verify signature
    const payload = JSON.stringify({
      collection: request.collection,
      documentId: request.documentId,
      timestamp: request.timestamp,
    });

    if (!verifyRevalidationSignature(payload, request.signature, secret)) {
      return { revalidated: false, paths: [], error: 'Invalid signature' };
    }

    // Find paths to revalidate
    const paths = pathMapping[request.collection] ?? [];
    const revalidatedPaths: string[] = [];

    for (const path of paths) {
      try {
        await revalidatePath(path);
        revalidatedPaths.push(path);
      } catch {
        // Skip failed paths
      }
    }

    return {
      revalidated: revalidatedPaths.length > 0,
      paths: revalidatedPaths,
    };
  };
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
