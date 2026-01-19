/**
 * Pocket - Local-first database for web applications
 *
 * @example
 * ```typescript
 * import { createDatabase, IndexedDBAdapter } from 'pocket';
 *
 * const db = await createDatabase({
 *   name: 'my-app',
 *   storage: new IndexedDBAdapter(),
 * });
 *
 * const todos = db.collection('todos');
 * await todos.insert({ title: 'Learn Pocket', completed: false });
 * ```
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
