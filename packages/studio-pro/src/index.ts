/**
 * @pocket/studio-pro - Visual Schema Designer & Studio Pro for Pocket
 *
 * Provides the data layer for schema inspection, query playground engine,
 * and sync dashboard monitoring for Pocket databases.
 *
 * ## Components
 *
 * - **SchemaInspector**: Infer, validate, diff, and generate TypeScript from schemas
 * - **QueryPlayground**: Execute queries with history tracking and reactive state
 * - **SyncDashboard**: Monitor sync peers, history, throughput, and conflicts
 * - **DataInspector**: Browse, search, and export collection data
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   createSchemaInspector,
 *   createProQueryPlayground,
 *   createSyncDashboard,
 *   createDataInspector,
 * } from '@pocket/studio-pro';
 *
 * const inspector = createSchemaInspector();
 * const schema = inspector.inspectCollection('users', [
 *   { _id: '1', name: 'Alice', age: 30 },
 * ]);
 *
 * const playground = createProQueryPlayground();
 * const result = playground.execute(
 *   { collection: 'users', filter: { age: { $gt: 21 } } },
 *   documents,
 * );
 *
 * const dashboard = createSyncDashboard();
 * dashboard.getState$().subscribe(state => console.log(state));
 * ```
 *
 * @packageDocumentation
 * @module @pocket/studio-pro
 */

// Types
export type {
  SchemaField,
  CollectionSchema,
  SchemaDesignerState,
  QueryPlaygroundState,
  QueryHistoryEntry,
  SyncDashboardState,
  SyncPeerInfo,
  SyncHistoryEntry,
  SyncConflict,
  StudioConfig,
  SchemaValidationError,
  DataInspectorState,
  SchemaDiff,
  QueryExplanation,
  CollectionStats,
} from './types.js';

// Schema Inspector
export { createSchemaInspector } from './schema-inspector.js';
export type { SchemaInspector } from './schema-inspector.js';

// Query Playground
export { createProQueryPlayground } from './query-playground.js';
export type { QueryPlayground, PlaygroundQuery, PlaygroundResult } from './query-playground.js';

// Sync Dashboard
export { createSyncDashboard } from './sync-dashboard.js';
export type { SyncDashboard } from './sync-dashboard.js';

// Data Inspector
export { createDataInspector } from './data-inspector.js';
export type { DataInspector } from './data-inspector.js';
