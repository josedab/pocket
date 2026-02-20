import type { ServerLoaderConfig, ServerLoaderResult, HydrationProps } from './types.js';

export interface CollectionSpec {
  collection: string;
  filter?: Record<string, unknown>;
}

/**
 * Server-side loader for fetching Pocket data during SSR / RSC rendering.
 * This module is server-only – it must not reference browser APIs.
 */
export class PocketServerLoader {
  private config: ServerLoaderConfig;
  private cache: Map<string, unknown[]> = new Map();
  private timestamp: number = Date.now();

  constructor(config: ServerLoaderConfig) {
    this.config = config;
  }

  /**
   * Fetch a single collection from the sync server.
   */
  async loadCollection<T = unknown>(
    collection: string,
    filter?: Record<string, unknown>,
  ): Promise<ServerLoaderResult<T>> {
    const url = new URL(`/api/collections/${encodeURIComponent(collection)}`, this.config.serverUrl);

    if (filter) {
      url.searchParams.set('filter', JSON.stringify(filter));
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    const timeout = this.config.timeout ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to load collection "${collection}": ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as T[];
      const now = Date.now();

      this.cache.set(collection, data as unknown[]);
      this.timestamp = now;

      return { data, timestamp: now, stale: false };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Timeout loading collection "${collection}" after ${timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Batch-fetch multiple collections in parallel.
   */
  async loadMultiple(specs: CollectionSpec[]): Promise<Map<string, ServerLoaderResult<unknown>>> {
    const results = new Map<string, ServerLoaderResult<unknown>>();

    const entries = await Promise.all(
      specs.map(async (spec) => {
        const result = await this.loadCollection(spec.collection, spec.filter);
        return [spec.collection, result] as const;
      }),
    );

    for (const [name, result] of entries) {
      results.set(name, result);
    }

    return results;
  }

  /**
   * Return serialisable hydration props for the client.
   */
  getHydrationProps(): HydrationProps {
    return {
      initialData: new Map(this.cache),
      serverTimestamp: this.timestamp,
    };
  }
}

/**
 * Factory function for creating a server loader instance.
 */
export function createServerLoader(config: ServerLoaderConfig): PocketServerLoader {
  return new PocketServerLoader(config);
}
