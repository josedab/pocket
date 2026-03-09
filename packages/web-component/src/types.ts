/**
 * @pocket/web-component — Types for the embeddable Web Component SDK.
 *
 * @module @pocket/web-component
 */

// ── Configuration Types ───────────────────────────────────

export interface PocketElementConfig {
  /** Database name */
  database: string;
  /** Collection to bind to */
  collection: string;
  /** Storage backend: 'memory' | 'indexeddb' | 'opfs' (default: 'memory') */
  storage?: string;
  /** Sync server URL (optional, enables sync) */
  syncUrl?: string;
  /** Initial query filter as JSON */
  filter?: string;
  /** Sort order as JSON */
  sort?: string;
  /** Maximum documents to display */
  limit?: number;
  /** Fields to display (comma-separated) */
  fields?: string;
  /** Display mode: 'table' | 'list' | 'json' | 'custom' */
  display?: DisplayMode;
  /** Enable editing (default: false) */
  editable?: boolean;
  /** Enable real-time updates (default: true) */
  realtime?: boolean;
  /** Theme: 'light' | 'dark' | 'auto' */
  theme?: 'light' | 'dark' | 'auto';
}

export type DisplayMode = 'table' | 'list' | 'json' | 'custom';

export interface PocketElementState {
  status: 'idle' | 'loading' | 'connected' | 'error' | 'offline';
  documents: Record<string, unknown>[];
  documentCount: number;
  error: string | null;
  syncStatus: 'disconnected' | 'syncing' | 'synced';
  lastUpdated: number | null;
}

export type PocketElementEvent =
  | { type: 'ready'; config: PocketElementConfig }
  | { type: 'data-changed'; documents: Record<string, unknown>[]; count: number }
  | { type: 'document-selected'; document: Record<string, unknown> }
  | { type: 'document-created'; document: Record<string, unknown> }
  | { type: 'document-updated'; document: Record<string, unknown> }
  | { type: 'document-deleted'; documentId: string }
  | { type: 'error'; message: string }
  | { type: 'sync-status-changed'; status: string };
