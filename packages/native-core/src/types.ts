/** Platform target */
export type NativePlatform = 'ios' | 'android';

/** Native SDK configuration */
export interface NativeSDKConfig {
  platform: NativePlatform;
  databasePath: string;
  encryptionKey?: string;
  syncUrl?: string;
  authToken?: string;
  enableLogging?: boolean;
  maxConcurrentQueries?: number;
}

/** Native document interface matching @pocket/core Document */
export interface NativeDocument {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  _updatedAt?: number;
  [key: string]: unknown;
}

/** Native query specification */
export interface NativeQuerySpec {
  collection: string;
  filter?: NativeFilterNode;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit?: number;
  skip?: number;
  fields?: string[];
}

/** Filter node for native queries */
export type NativeFilterNode =
  | { type: 'eq'; field: string; value: unknown }
  | { type: 'neq'; field: string; value: unknown }
  | { type: 'gt'; field: string; value: unknown }
  | { type: 'gte'; field: string; value: unknown }
  | { type: 'lt'; field: string; value: unknown }
  | { type: 'lte'; field: string; value: unknown }
  | { type: 'in'; field: string; values: unknown[] }
  | { type: 'contains'; field: string; value: string }
  | { type: 'and'; conditions: NativeFilterNode[] }
  | { type: 'or'; conditions: NativeFilterNode[] }
  | { type: 'not'; condition: NativeFilterNode };

/** Native query result */
export interface NativeQueryResult<T = NativeDocument> {
  documents: T[];
  totalCount: number;
  executionTimeMs: number;
}

/** Sync status for native clients */
export type NativeSyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

/** Sync event from native layer */
export interface NativeSyncEvent {
  type:
    | 'push_started'
    | 'push_completed'
    | 'pull_started'
    | 'pull_completed'
    | 'conflict'
    | 'error';
  timestamp: number;
  details?: Record<string, unknown>;
}

/** Conflict resolution strategy */
export type NativeConflictStrategy =
  | 'server-wins'
  | 'client-wins'
  | 'last-write-wins'
  | 'manual';

/** Native collection interface */
export interface NativeCollectionSpec {
  name: string;
  insert(doc: Omit<NativeDocument, '_id' | '_rev'>): Promise<NativeDocument>;
  get(id: string): Promise<NativeDocument | null>;
  update(
    id: string,
    changes: Partial<NativeDocument>,
  ): Promise<NativeDocument>;
  delete(id: string): Promise<void>;
  find(
    query: Omit<NativeQuerySpec, 'collection'>,
  ): Promise<NativeQueryResult>;
  count(filter?: NativeFilterNode): Promise<number>;
  observe(
    query?: Omit<NativeQuerySpec, 'collection'>,
  ): NativeObservable<NativeDocument[]>;
  observeOne(id: string): NativeObservable<NativeDocument | null>;
}

/** Platform-agnostic observable */
export interface NativeObservable<T> {
  subscribe(observer: NativeObserver<T>): NativeSubscription;
}

export interface NativeObserver<T> {
  onNext(value: T): void;
  onError(error: Error): void;
  onComplete(): void;
}

export interface NativeSubscription {
  unsubscribe(): void;
  readonly isUnsubscribed: boolean;
}

/** Native database interface spec */
export interface NativeDatabaseSpec {
  readonly platform: NativePlatform;
  readonly isOpen: boolean;
  open(config: NativeSDKConfig): Promise<void>;
  close(): Promise<void>;
  collection(name: string): NativeCollectionSpec;
  listCollections(): Promise<string[]>;
  deleteCollection(name: string): Promise<void>;
  startSync(config: {
    url: string;
    authToken?: string;
    collections?: string[];
    conflictStrategy?: NativeConflictStrategy;
  }): Promise<void>;
  stopSync(): Promise<void>;
  getSyncStatus(): NativeSyncStatus;
  observeSyncEvents(): NativeObservable<NativeSyncEvent>;
  exportData(): Promise<Uint8Array>;
  importData(
    data: Uint8Array,
  ): Promise<{ imported: number; failed: number }>;
}

/** USP (Universal Sync Protocol) message types for native clients */
export type USPMessageType =
  | 'handshake'
  | 'push'
  | 'pull'
  | 'push_ack'
  | 'pull_response'
  | 'error';

export interface USPMessage {
  type: USPMessageType;
  version: string;
  timestamp: number;
  payload: unknown;
}

/** Conformance test case for native SDK validation */
export interface ConformanceTestCase {
  id: string;
  name: string;
  category: 'crud' | 'query' | 'sync' | 'conflict' | 'offline';
  description: string;
  steps: ConformanceTestStep[];
  expectedResult: unknown;
}

export interface ConformanceTestStep {
  action: string;
  params: Record<string, unknown>;
  expectedOutcome?: unknown;
}
