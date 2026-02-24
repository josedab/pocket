/**
 * RLSMiddleware — Storage layer interceptor for row-level security.
 *
 * Wraps a DocumentStore and intercepts all read/write operations through
 * the DeclarativeRLS policy engine. Documents that fail policy evaluation
 * are filtered out (reads) or rejected (writes).
 *
 * @example
 * ```typescript
 * const rls = createDeclarativeRLS();
 * rls.addPolicy(policy().name('tenant').collection('orders').actions('read').allow().tenantIsolation().build());
 *
 * const secureStore = createRLSMiddleware(originalStore, rls, 'orders', () => authContext);
 * const docs = await secureStore.getAll(); // Only returns tenant-visible docs
 * ```
 */

import type { DeclarativeRLS } from './declarative-rls.js';
import type { AuthContext, PolicyAction } from './types.js';

// ── Types ──────────────────────────────────────────────────

/** Minimal DocumentStore interface for wrapping */
export interface WrappableStore<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string;
  get(id: string): Promise<T | null>;
  getAll(): Promise<T[]>;
  put(doc: T): Promise<T>;
  delete(id: string): Promise<void>;
  query(q: unknown): Promise<T[]>;
  count(q?: unknown): Promise<number>;
}

export interface RLSMiddlewareConfig {
  /** If true, throw on denied writes instead of silently skipping. @default true */
  throwOnDenied?: boolean;
  /** If true, log all denials for debugging. @default false */
  logDenials?: boolean;
}

export interface RLSDeniedError extends Error {
  action: PolicyAction;
  collection: string;
  documentId: string;
}

// ── Implementation ────────────────────────────────────────

export class RLSMiddleware<T extends Record<string, unknown>> implements WrappableStore<T> {
  readonly name: string;
  private readonly inner: WrappableStore<T>;
  private readonly rls: DeclarativeRLS;
  private readonly collection: string;
  private readonly getAuthContext: () => AuthContext;
  private readonly config: Required<RLSMiddlewareConfig>;

  private deniedCount = 0;

  constructor(
    store: WrappableStore<T>,
    rls: DeclarativeRLS,
    collection: string,
    getAuthContext: () => AuthContext,
    config: RLSMiddlewareConfig = {}
  ) {
    this.inner = store;
    this.name = store.name;
    this.rls = rls;
    this.collection = collection;
    this.getAuthContext = getAuthContext;
    this.config = {
      throwOnDenied: config.throwOnDenied ?? true,
      logDenials: config.logDenials ?? false,
    };
  }

  /**
   * Get a document by ID, returns null if denied.
   */
  async get(id: string): Promise<T | null> {
    const doc = await this.inner.get(id);
    if (!doc) return null;

    if (!this.checkAccess('read', doc)) return null;
    return doc;
  }

  /**
   * Get all documents, filtered by RLS policies.
   */
  async getAll(): Promise<T[]> {
    const docs = await this.inner.getAll();
    return this.filterAllowed('read', docs);
  }

  /**
   * Insert or update a document, checking write permission.
   */
  async put(doc: T): Promise<T> {
    const action: PolicyAction = (await this.inner.get(doc._id as string)) ? 'update' : 'insert';
    this.enforceAccess(action, doc);
    return this.inner.put(doc);
  }

  /**
   * Delete a document, checking delete permission.
   */
  async delete(id: string): Promise<void> {
    const doc = await this.inner.get(id);
    if (doc) {
      this.enforceAccess('delete', doc);
    }
    return this.inner.delete(id);
  }

  /**
   * Query documents, filtered by RLS policies.
   */
  async query(q: unknown): Promise<T[]> {
    const docs = await this.inner.query(q);
    return this.filterAllowed('read', docs);
  }

  /**
   * Count documents visible to the current user.
   */
  async count(q?: unknown): Promise<number> {
    const docs = await this.inner.query(q ?? {});
    return this.filterAllowed('read', docs).length;
  }

  /** Get the number of denied operations. */
  getDeniedCount(): number {
    return this.deniedCount;
  }

  // ── Private ────────────────────────────────────────────

  private checkAccess(action: PolicyAction, doc: T): boolean {
    const ctx = this.getAuthContext();
    const result = this.rls.evaluate(action, this.collection, doc as Record<string, unknown>, ctx);

    if (!result.allowed) {
      this.deniedCount++;
      if (this.config.logDenials) {
        console.warn(
          `[RLS] Denied ${action} on ${this.collection}/${(doc as Record<string, unknown>)._id}: ${result.reason}`
        );
      }
    }

    return result.allowed;
  }

  private enforceAccess(action: PolicyAction, doc: T): void {
    if (!this.checkAccess(action, doc) && this.config.throwOnDenied) {
      const err = new Error(
        `RLS: ${action} denied on ${this.collection}/${(doc as Record<string, unknown>)._id}`
      ) as RLSDeniedError;
      err.action = action;
      err.collection = this.collection;
      err.documentId = String((doc as Record<string, unknown>)._id ?? '');
      throw err;
    }
  }

  private filterAllowed(action: PolicyAction, docs: T[]): T[] {
    const ctx = this.getAuthContext();
    return docs.filter((doc) => {
      const result = this.rls.evaluate(
        action,
        this.collection,
        doc as Record<string, unknown>,
        ctx
      );
      if (!result.allowed) this.deniedCount++;
      return result.allowed;
    });
  }
}

export function createRLSMiddleware<T extends Record<string, unknown>>(
  store: WrappableStore<T>,
  rls: DeclarativeRLS,
  collection: string,
  getAuthContext: () => AuthContext,
  config?: RLSMiddlewareConfig
): RLSMiddleware<T> {
  return new RLSMiddleware(store, rls, collection, getAuthContext, config);
}
