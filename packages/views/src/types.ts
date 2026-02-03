import type { Document } from '@pocket/core';

/**
 * Definition for a materialized view.
 *
 * A view definition specifies which documents from a collection should be
 * included in the view, how they should be sorted, and optional transformations.
 *
 * @typeParam T - The document type, must extend {@link Document}
 */
export interface ViewDefinition<T extends Document = Document> {
  /** Unique name for this view */
  name: string;
  /** Source collection name */
  collection: string;
  /** Filter specification to select documents for the view */
  filter?: Record<string, unknown>;
  /** Sort specification: field name to direction mapping */
  sort?: Record<string, 'asc' | 'desc'>;
  /** Maximum number of documents in the view */
  limit?: number;
  /** Projection: fields to include (1) or exclude (0) */
  projection?: Record<string, 0 | 1>;
  /** Optional transform function applied to each document */
  transform?: (doc: T) => unknown;
}

/**
 * Internal state of a materialized view.
 *
 * @typeParam T - The document type
 */
export interface ViewState<T = unknown> {
  /** View name */
  name: string;
  /** Source collection name */
  collection: string;
  /** Current result set */
  results: T[];
  /** Set of document IDs currently in the view (for O(1) membership checks) */
  resultIds: Set<string>;
  /** Last processed change sequence number */
  lastSequence: number;
  /** Timestamp when the view was created */
  createdAt: number;
  /** Timestamp of the last update to the view */
  updatedAt: number;
  /** Number of times the view results have been read */
  hitCount: number;
}

/**
 * Statistics about a materialized view.
 */
export interface ViewStats {
  /** View name */
  name: string;
  /** Number of documents currently in the view */
  resultCount: number;
  /** Timestamp of last update */
  lastUpdated: number;
  /** Number of times the view has been read */
  hitCount: number;
  /** Average time (ms) spent applying incremental updates */
  avgUpdateTimeMs: number;
}

/**
 * Events emitted by the view system for monitoring.
 *
 * @typeParam T - The document type
 */
export type ViewEvent<T = unknown> =
  | { type: 'view:created'; name: string }
  | { type: 'view:updated'; name: string; delta: ViewDelta<T> }
  | { type: 'view:dropped'; name: string }
  | { type: 'view:invalidated'; name: string };

/**
 * Describes the incremental changes applied to a view in a single update.
 *
 * @typeParam T - The document type
 */
export interface ViewDelta<T = unknown> {
  /** Documents added to the view */
  added: T[];
  /** Documents removed from the view */
  removed: T[];
  /** Documents that were modified in place */
  modified: { before: T; after: T }[];
}
