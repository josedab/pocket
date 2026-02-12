/**
 * @pocket/studio - Visual Database Studio for Pocket
 *
 * A web-based database inspector and management tool for Pocket databases.
 * Browse collections, run queries, inspect sync state, and profile performance.
 *
 * ## Components
 *
 * - **DatabaseInspector**: Read-only browsing of collections, documents, and indexes
 * - **DocumentEditor**: Insert, update, and delete documents with schema validation
 * - **SyncInspector**: Monitor sync engine status, conflicts, and history
 * - **PerformanceProfiler**: Measure and analyze database operation performance
 * - **StudioServer**: HTTP REST API server for all studio features
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createStudioServer } from '@pocket/studio';
 * import { Database } from '@pocket/core';
 *
 * const db = await Database.create({ name: 'my-app', storage });
 *
 * const studio = createStudioServer({
 *   port: 4680,
 *   database: db,
 * });
 *
 * await studio.start();
 * // Studio REST API available at http://localhost:4680
 * ```
 *
 * ## Using Individual Components
 *
 * ```typescript
 * import {
 *   createDatabaseInspector,
 *   createDocumentEditor,
 *   createSyncInspector,
 *   createPerformanceProfiler,
 * } from '@pocket/studio';
 *
 * const inspector = createDatabaseInspector(db);
 * const collections = await inspector.listCollections();
 *
 * const editor = createDocumentEditor(db);
 * await editor.insertDocument('users', { name: 'Alice' });
 *
 * const profiler = createPerformanceProfiler(db);
 * profiler.startProfiling();
 * ```
 *
 * @packageDocumentation
 * @module @pocket/studio
 */

// Types
export type {
  CollectionInfo,
  ConflictInfo,
  DocumentEditorOptions,
  IndexInfo,
  PerformanceProfile,
  QueryResult,
  StudioConfig,
  StudioEvent,
  StudioQueryPlan,
  SyncHistoryEntry,
  SyncInspection,
} from './types.js';

// Database Inspector
export { DatabaseInspector, createDatabaseInspector } from './database-inspector.js';

// Document Editor
export { DocumentEditor, createDocumentEditor } from './document-editor.js';

// Sync Inspector
export { SyncInspector, createSyncInspector } from './sync-inspector.js';
export type { SyncEngineLike } from './sync-inspector.js';

// Performance Profiler
export { PerformanceProfiler, createPerformanceProfiler } from './performance-profiler.js';
export type { OperationStats } from './performance-profiler.js';

// Studio Server
export { StudioServer, createStudioServer } from './studio-server.js';

// Query Playground
export {
  QueryPlayground,
  createQueryPlayground,
  type QueryExplainResult,
  type QueryHistoryEntry,
  type QueryPlaygroundConfig,
  type SavedQuery,
} from './query-playground.js';

// DevTools Bridge
export {
  DevToolsBridge,
  createDevToolsBridge,
  type DevToolsAPI,
  type DevToolsBridgeConfig,
  type DevToolsPerformanceStats,
  type DevToolsQueryHistoryEntry,
  type DevToolsSnapshot,
} from './devtools-bridge.js';

// Chrome Extension Bridge
export {
  ChromeExtensionBridge,
  createChromeExtensionBridge,
  getChromeExtensionManifest,
  type ChromeExtensionBridgeConfig,
  type ChromeExtensionManifest,
  type ChromeExtensionMessage,
  type RegisteredDatabase,
} from './chrome-extension.js';

// Schema Designer
export {
  SchemaDesigner,
  createSchemaDesigner,
  type CollectionSchemaInfo,
  type SchemaDesignerConfig,
  type SchemaFieldInfo,
  type SchemaRelationship,
  type SchemaValidationIssue,
} from './schema-designer.js';

// Data Explorer
export {
  DataExplorer,
  createDataExplorer,
  type AggregationResult,
  type DataExplorerConfig,
  type DataPage,
  type FieldStats,
} from './data-explorer.js';

// AI Query Builder
export {
  AIQueryBuilder,
  createAIQueryBuilder,
  type AIQueryBuilderConfig,
  type AIQueryFieldInfo,
  type AIQueryHistoryEntry,
  type AutoCompleteSuggestion,
  type ParsedQuery,
  type PerformanceEstimate,
} from './ai-query-builder.js';

// Visual Timeline
export {
  VisualTimeline,
  createVisualTimeline,
  type DocumentLifecycle,
  type TimelineBucket,
  type TimelineChange,
  type TimelineDiff,
  type TimelineGroup,
  type TimelineInteractionEvent,
  type TimelineRange,
  type VisualTimelineConfig,
} from './visual-timeline.js';

// Import/Export Manager
export {
  ImportExportManager,
  createImportExportManager,
  type ExportFormat,
  type ExportOptions,
  type FieldMapping,
  type ImportExportManagerConfig,
  type ImportExportProgress,
  type ImportFormat,
  type ImportOptions,
  type ImportResult,
  type ImportSchemaField,
  type ImportValidationError,
} from './import-export-manager.js';

// Dashboard Controller
export {
  DashboardController,
  createDashboardController,
  type DashboardCommand,
  type DashboardConfig,
  type DashboardNotification,
  type DashboardPanel,
  type DashboardState,
  type DashboardStats,
} from './dashboard-controller.js';

// Sync Visualizer
export {
  SyncVisualizer,
  createSyncVisualizer,
  type ConnectionInfo,
  type SyncEventData,
  type SyncHealthStatus,
  type SyncTimelineEntry,
  type SyncVisualizerConfig,
} from './sync-visualizer.js';

// Metrics Collector
export {
  MetricsCollector,
  createMetricsCollector,
  type MetricSummary,
  type MetricsCollectorConfig,
  type TimeSeriesPoint,
} from './metrics-collector.js';
