import type { ChangeEvent, Document, DocumentUpdate, NewDocument } from '../types/document.js';
import type { QuerySpec } from '../types/query.js';

/**
 * Plugin lifecycle hooks
 */
export type PluginHook =
  | 'beforeInsert'
  | 'afterInsert'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete'
  | 'beforeQuery'
  | 'afterQuery'
  | 'beforeGet'
  | 'afterGet'
  | 'onError'
  | 'onInit'
  | 'onDestroy';

/**
 * Context for insert operations
 */
export interface InsertContext<T extends Document = Document> {
  collection: string;
  document: NewDocument<T>;
  timestamp: number;
}

/**
 * Context for update operations
 */
export interface UpdateContext<T extends Document = Document> {
  collection: string;
  documentId: string;
  changes: DocumentUpdate<T>;
  existingDocument: T;
  timestamp: number;
}

/**
 * Context for delete operations
 */
export interface DeleteContext<T extends Document = Document> {
  collection: string;
  documentId: string;
  existingDocument: T | null;
  timestamp: number;
}

/**
 * Context for query operations
 */
export interface QueryContext<T extends Document = Document> {
  collection: string;
  spec: QuerySpec<T>;
  timestamp: number;
}

/**
 * Context for get operations
 */
export interface GetContext {
  collection: string;
  documentId: string;
  timestamp: number;
}

/**
 * Result from insert hook
 */
export interface InsertHookResult<T extends Document = Document> {
  document?: NewDocument<T>;
  skip?: boolean;
  error?: Error;
}

/**
 * Result from update hook
 */
export interface UpdateHookResult<T extends Document = Document> {
  changes?: DocumentUpdate<T>;
  skip?: boolean;
  error?: Error;
}

/**
 * Result from delete hook
 */
export interface DeleteHookResult {
  skip?: boolean;
  error?: Error;
}

/**
 * Result from query hook
 */
export interface QueryHookResult<T extends Document = Document> {
  spec?: QuerySpec<T>;
  results?: T[];
  skip?: boolean;
  error?: Error;
}

/**
 * Result from get hook
 */
export interface GetHookResult<T extends Document = Document> {
  document?: T | null;
  skip?: boolean;
  error?: Error;
}

/**
 * Error context
 */
export interface ErrorContext {
  operation: string;
  collection: string;
  error: Error;
  documentId?: string;
  timestamp: number;
}

/**
 * Plugin definition
 */
export interface PluginDefinition<T extends Document = Document> {
  /** Unique plugin name */
  name: string;
  /** Plugin version */
  version?: string;
  /** Plugin priority (higher = runs first) */
  priority?: number;

  /** Called when plugin is initialized */
  onInit?: () => void | Promise<void>;

  /** Called when plugin is destroyed */
  onDestroy?: () => void | Promise<void>;

  /** Called before insert */
  beforeInsert?: (
    context: InsertContext<T>
  ) => InsertHookResult<T> | Promise<InsertHookResult<T>> | undefined;

  /** Called after insert */
  afterInsert?: (document: T, context: InsertContext<T>) => void | Promise<void>;

  /** Called before update */
  beforeUpdate?: (
    context: UpdateContext<T>
  ) => UpdateHookResult<T> | Promise<UpdateHookResult<T>> | undefined;

  /** Called after update */
  afterUpdate?: (document: T, context: UpdateContext<T>) => void | Promise<void>;

  /** Called before delete */
  beforeDelete?: (
    context: DeleteContext<T>
  ) => DeleteHookResult | Promise<DeleteHookResult> | undefined;

  /** Called after delete */
  afterDelete?: (context: DeleteContext<T>) => void | Promise<void>;

  /** Called before query */
  beforeQuery?: (
    context: QueryContext<T>
  ) => QueryHookResult<T> | Promise<QueryHookResult<T>> | undefined;

  /** Called after query */
  afterQuery?: (results: T[], context: QueryContext<T>) => T[] | Promise<T[]> | undefined;

  /** Called before get */
  beforeGet?: (context: GetContext) => GetHookResult<T> | Promise<GetHookResult<T>> | undefined;

  /** Called after get */
  afterGet?: (document: T | null, context: GetContext) => T | null | Promise<T | null> | undefined;

  /** Called on error */
  onError?: (context: ErrorContext) => void | Promise<void>;
}

/**
 * Middleware function type
 */
export type MiddlewareFunction<TContext, TResult = void> = (
  context: TContext,
  next: () => Promise<TResult>
) => Promise<TResult>;

/**
 * Middleware definition
 */
export interface MiddlewareDefinition {
  /** Middleware name */
  name: string;
  /** Operations this middleware applies to */
  operations?: ('insert' | 'update' | 'delete' | 'query' | 'get')[];
  /** Collections this middleware applies to (empty = all) */
  collections?: string[];
  /** Middleware function */
  handler: MiddlewareFunction<OperationContext, unknown>;
}

/**
 * Generic operation context
 */
export interface OperationContext {
  operation: 'insert' | 'update' | 'delete' | 'query' | 'get';
  collection: string;
  timestamp: number;
  documentId?: string;
  document?: unknown;
  changes?: unknown;
  spec?: unknown;
}

/**
 * Plugin state
 */
export type PluginState = 'pending' | 'initialized' | 'error' | 'destroyed';

/**
 * Registered plugin info
 */
export interface RegisteredPlugin {
  definition: PluginDefinition;
  state: PluginState;
  error?: Error;
}

/**
 * Change listener callback
 */
export type ChangeListener<T extends Document = Document> = (
  event: ChangeEvent<T>
) => void | Promise<void>;
