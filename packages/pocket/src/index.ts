/**
 * @packageDocumentation
 *
 * # Pocket - Local-First Database for Web Applications
 *
 * Pocket is a comprehensive local-first database solution that enables
 * offline-capable web applications with real-time sync capabilities.
 *
 * ## Installation
 *
 * ```bash
 * npm install pocket
 * ```
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createDatabase, createIndexedDBStorage } from 'pocket';
 *
 * // Create a database
 * const db = await createDatabase({
 *   name: 'my-app',
 *   storage: createIndexedDBStorage(),
 * });
 *
 * // Get a collection and insert data
 * const todos = db.collection('todos');
 * await todos.insert({ title: 'Learn Pocket', completed: false });
 *
 * // Query documents
 * const activeTodos = await todos.find({ completed: false }).exec();
 * ```
 *
 * ## Architecture
 *
 * Pocket follows a local-first architecture:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                     Your Application                        │
 * │  ┌─────────────────┐  ┌─────────────────┐                   │
 * │  │  React Hooks    │  │   Direct API    │                   │
 * │  │  (useLiveQuery) │  │   (Collection)  │                   │
 * │  └────────┬────────┘  └────────┬────────┘                   │
 * └───────────┼────────────────────┼────────────────────────────┘
 *             │                    │
 * ┌───────────▼────────────────────▼────────────────────────────┐
 * │                     Pocket Core                              │
 * │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
 * │  │  Database   │  │  Collection  │  │  Query Engine      │  │
 * │  │             │  │              │  │  (Filter, Sort,    │  │
 * │  │             │  │              │  │   Index, Live)     │  │
 * │  └──────┬──────┘  └──────┬───────┘  └──────────┬─────────┘  │
 * └─────────┼────────────────┼────────────────────┼─────────────┘
 *           │                │                    │
 * ┌─────────▼────────────────▼────────────────────▼─────────────┐
 * │                   Storage Layer                              │
 * │  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐    │
 * │  │ IndexedDB  │  │   OPFS     │  │   Memory (Testing)  │    │
 * │  └────────────┘  └────────────┘  └─────────────────────┘    │
 * └─────────────────────────────────────────────────────────────┘
 *                          │ (optional)
 * ┌────────────────────────▼────────────────────────────────────┐
 * │                    Sync Layer                                │
 * │  ┌───────────────┐  ┌─────────────────┐  ┌────────────────┐ │
 * │  │ Sync Engine   │  │ Conflict        │  │ Transport      │ │
 * │  │               │  │ Resolution      │  │ (WS/HTTP)      │ │
 * │  └───────────────┘  └─────────────────┘  └────────────────┘ │
 * └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Key Features
 *
 * - **Local-First**: All data lives on the client first - reads and writes
 *   happen locally with no network latency
 * - **Offline Support**: Works without network connection; syncs when online
 * - **Reactive Queries**: Subscribe to query results and get real-time updates
 * - **Type-Safe**: Full TypeScript support with generics for collections
 * - **Multiple Storage Backends**: IndexedDB, OPFS, SQLite, or in-memory
 * - **Sync Ready**: Optional sync layer for multi-device synchronization
 *
 * ## Package Exports
 *
 * This main `pocket` package re-exports commonly used APIs from:
 * - `@pocket/core` - Database, Collection, Query engine
 * - `@pocket/storage-indexeddb` - IndexedDB storage adapter
 * - `@pocket/storage-opfs` - OPFS storage adapter
 * - `@pocket/storage-memory` - In-memory storage adapter
 *
 * For React integration, import from `pocket/react`.
 * For sync functionality, import from `pocket/sync`.
 *
 * ## Example: Complete Setup
 *
 * ```typescript
 * import { createDatabase, createIndexedDBStorage } from 'pocket';
 *
 * interface Todo {
 *   _id: string;
 *   title: string;
 *   completed: boolean;
 *   createdAt: number;
 * }
 *
 * // Create database with typed collections
 * const db = await createDatabase({
 *   name: 'todo-app',
 *   storage: createIndexedDBStorage(),
 *   collections: [{
 *     name: 'todos',
 *     indexes: [
 *       { fields: ['completed'] },
 *       { fields: ['createdAt'] }
 *     ]
 *   }]
 * });
 *
 * // Get typed collection
 * const todos = db.collection<Todo>('todos');
 *
 * // CRUD operations
 * await todos.insert({ title: 'Learn Pocket', completed: false, createdAt: Date.now() });
 * await todos.update('todo-1', { completed: true });
 * await todos.delete('todo-2');
 *
 * // Query with filters, sorting, and limits
 * const recentActive = await todos
 *   .find({ completed: false })
 *   .sort({ createdAt: -1 })
 *   .limit(10)
 *   .exec();
 *
 * // Reactive query (RxJS Observable)
 * todos.find({ completed: false }).$.subscribe(results => {
 *   console.log('Active todos:', results);
 * });
 *
 * // Cleanup
 * await db.close();
 * ```
 *
 * @module pocket
 *
 * @see {@link Database} for database operations
 * @see {@link Collection} for collection operations
 * @see {@link QueryBuilder} for query building
 */

// Core exports
export {
  // Change tracking
  ChangeFeed,
  // Collection
  Collection,
  // Database
  Database,
  FieldQuery,
  GlobalChangeFeed,
  HybridLogicalClock,
  LamportClock,
  // Observable/Reactive
  LiveQuery,
  ObservableAsync,
  // Observable utilities
  ObservableValue,
  // Query builder
  QueryBuilder,
  // Query executor
  QueryExecutor,
  QueryPlanner,
  // Schema
  Schema,
  ValidationError,
  // Vector clock
  VectorClockUtil,
  applyAction,
  areConcurrent,
  cloneDocument,
  compareRevisions,
  compareValues,
  compareVectorClocks,
  createDatabase,
  createDeferred,
  createLiveQuery,
  createQueryBuilder,
  debounce,
  documentsEqual,
  generateId,
  generateRevision,
  getNestedValue,
  happenedBefore,
  isEqual,
  // Query operators
  matchesCondition,
  matchesFilter,
  mergeVectorClocks,
  parseRevision,
  prepareDocumentUpdate,
  // Document utilities
  prepareNewDocument,
  prepareSoftDelete,
  // EventReduce
  reduceEvent,
  setNestedValue,
  throttle,
  type AsyncState,
  type ChangeBatch,
  type ChangeEvent,
  type ChangeFeedOptions,
  type ChangeOperation,
  type CollectionConfig,
  type DatabaseConfig,
  type DatabaseOptions,
  type DatabaseStats,
  type Deferred,
  // Types
  type Document,
  type DocumentConflict,
  type DocumentStore,
  type DocumentUpdate,
  type EventReduceAction,
  type FieldDefinition,
  type FieldType,
  type IndexDefinition,
  type LiveQueryOptions,
  type LiveQueryState,
  type NewDocument,
  type NormalizedIndex,
  type QueryFilter,
  type QueryPlan,
  type QueryResult,
  // Query types
  type QuerySpec,
  type SchemaDefinition,
  type ValidationError as SchemaValidationError,
  type SortDirection,
  type SortSpec,

  // Storage types
  type StorageAdapter,
  type StorageConfig,
  type StorageQuery,
  type StorageStats,
  type StoredDocument,
  type ValidationResult,
  type VectorClock,
} from '@pocket/core';

// Storage adapters
export {
  IndexedDBAdapter,
  createIndexedDBStorage,
  type IndexedDBAdapterOptions,
} from '@pocket/storage-indexeddb';
export { MemoryStorageAdapter, createMemoryStorage } from '@pocket/storage-memory';
export {
  OPFSAdapter,
  WriteAheadLog,
  createOPFSStorage,
  createWAL,
  type OPFSAdapterOptions,
} from '@pocket/storage-opfs';
