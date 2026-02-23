/**
 * Configuration for the server-side data loader.
 */
export interface ServerLoaderConfig {
  serverUrl: string;
  authToken?: string;
  collections?: string[];
  timeout?: number;
}

/**
 * Result returned from a server-side collection load.
 */
export interface ServerLoaderResult<T> {
  data: T[];
  timestamp: number;
  stale: boolean;
}

/**
 * Props for hydrating server data on the client.
 */
export interface HydrationProps {
  initialData: Map<string, unknown[]>;
  serverTimestamp: number;
}

/**
 * Top-level configuration for the Pocket Next.js integration.
 */
export interface PocketNextConfig {
  serverUrl: string;
  authToken?: string;
  revalidate?: number;
}
