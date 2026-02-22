/**
 * DatabaseRegistry — Manages multiple isolated database instances per application.
 *
 * Supports the "database-per-feature" pattern where each feature
 * owns its own database. Provides cross-DB federation queries
 * and shared lifecycle management.
 *
 * @example
 * ```typescript
 * const registry = new DatabaseRegistry({ maxDatabases: 10 });
 *
 * registry.register('users-db', usersDb);
 * registry.register('orders-db', ordersDb);
 *
 * // Cross-DB query
 * const result = await registry.federatedQuery({
 *   from: { db: 'users-db', collection: 'users' },
 *   join: { db: 'orders-db', collection: 'orders', on: 'userId' },
 *   filter: { active: true },
 * });
 * ```
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export interface DatabaseRegistryConfig {
  maxDatabases?: number;
  lazyInit?: boolean;
  memoryBudgetMB?: number;
}

export interface RegisteredDatabase {
  name: string;
  instance: FederatableDatabase;
  registeredAt: number;
  lastAccessedAt: number;
  accessCount: number;
  active: boolean;
}

/** Minimal database interface for federation */
export interface FederatableDatabase {
  name: string;
  collection<T extends Record<string, unknown>>(
    name: string
  ): {
    find(filter?: Record<string, unknown>): { exec(): Promise<T[]> };
  };
  listCollections?(): Promise<string[]>;
  close?(): Promise<void>;
}

export interface FederatedQuerySpec {
  from: { db: string; collection: string; filter?: Record<string, unknown> };
  join?: { db: string; collection: string; on: string; foreignKey?: string };
  filter?: Record<string, unknown>;
  limit?: number;
}

export interface FederatedQueryResult {
  rows: Record<string, unknown>[];
  sources: string[];
  joinedCount: number;
  executionTimeMs: number;
}

export interface RegistryStats {
  databaseCount: number;
  activeDatabases: number;
  totalQueries: number;
  totalCollections: number;
}

export type RegistryEvent =
  | { type: 'db:registered'; name: string }
  | { type: 'db:unregistered'; name: string }
  | { type: 'db:accessed'; name: string }
  | { type: 'query:federated'; sources: string[]; rowCount: number };

// ── Implementation ────────────────────────────────────────

export class DatabaseRegistry {
  private readonly config: Required<DatabaseRegistryConfig>;
  private readonly databases = new Map<string, RegisteredDatabase>();
  private readonly destroy$ = new Subject<void>();
  private readonly eventsSubject = new Subject<RegistryEvent>();
  private readonly statsSubject: BehaviorSubject<RegistryStats>;

  private totalQueries = 0;

  readonly events$: Observable<RegistryEvent>;
  readonly stats$: Observable<RegistryStats>;

  constructor(config: DatabaseRegistryConfig = {}) {
    this.config = {
      maxDatabases: config.maxDatabases ?? 20,
      lazyInit: config.lazyInit ?? true,
      memoryBudgetMB: config.memoryBudgetMB ?? 256,
    };

    this.statsSubject = new BehaviorSubject<RegistryStats>(this.buildStats());
    this.events$ = this.eventsSubject.asObservable().pipe(takeUntil(this.destroy$));
    this.stats$ = this.statsSubject.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Register a database instance.
   */
  register(name: string, db: FederatableDatabase): void {
    if (this.databases.size >= this.config.maxDatabases) {
      throw new Error(`Max databases (${this.config.maxDatabases}) reached`);
    }
    if (this.databases.has(name)) {
      throw new Error(`Database "${name}" is already registered`);
    }

    this.databases.set(name, {
      name,
      instance: db,
      registeredAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      active: true,
    });

    this.eventsSubject.next({ type: 'db:registered', name });
    this.statsSubject.next(this.buildStats());
  }

  /**
   * Unregister and optionally close a database.
   */
  async unregister(name: string, close = false): Promise<void> {
    const entry = this.databases.get(name);
    if (!entry) throw new Error(`Database "${name}" not found`);

    if (close && entry.instance.close) {
      await entry.instance.close();
    }

    this.databases.delete(name);
    this.eventsSubject.next({ type: 'db:unregistered', name });
    this.statsSubject.next(this.buildStats());
  }

  /**
   * Get a database by name.
   */
  get(name: string): FederatableDatabase | undefined {
    const entry = this.databases.get(name);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      entry.accessCount++;
      this.eventsSubject.next({ type: 'db:accessed', name });
    }
    return entry?.instance;
  }

  /**
   * List all registered databases.
   */
  list(): RegisteredDatabase[] {
    return [...this.databases.values()];
  }

  /**
   * Execute a federated query across databases.
   */
  async federatedQuery(spec: FederatedQuerySpec): Promise<FederatedQueryResult> {
    const start = performance.now();
    this.totalQueries++;

    // Fetch primary data
    const primaryDb = this.get(spec.from.db);
    if (!primaryDb) throw new Error(`Database "${spec.from.db}" not found`);

    const primaryCol = primaryDb.collection<Record<string, unknown>>(spec.from.collection);
    let primaryDocs = await primaryCol.find(spec.from.filter).exec();

    // Apply global filter
    if (spec.filter) {
      primaryDocs = primaryDocs.filter((doc) => {
        for (const [key, value] of Object.entries(spec.filter!)) {
          if (doc[key] !== value) return false;
        }
        return true;
      });
    }

    const sources = [spec.from.db];
    let joinedCount = 0;

    // Join with secondary database
    if (spec.join) {
      const joinDb = this.get(spec.join.db);
      if (!joinDb) throw new Error(`Database "${spec.join.db}" not found`);

      const joinCol = joinDb.collection<Record<string, unknown>>(spec.join.collection);
      const joinDocs = await joinCol.find().exec();

      sources.push(spec.join.db);
      const joinField = spec.join.on;
      const foreignKey = spec.join.foreignKey ?? spec.join.on;

      // Build lookup index
      const joinIndex = new Map<unknown, Record<string, unknown>[]>();
      for (const jDoc of joinDocs) {
        const key = jDoc[foreignKey];
        const existing = joinIndex.get(key);
        if (existing) existing.push(jDoc);
        else joinIndex.set(key, [jDoc]);
      }

      // Merge
      const merged: Record<string, unknown>[] = [];
      for (const pDoc of primaryDocs) {
        const key = pDoc[joinField];
        const matches = joinIndex.get(key) ?? [];
        if (matches.length > 0) {
          for (const match of matches) {
            merged.push({ ...pDoc, _joined: match });
            joinedCount++;
          }
        } else {
          merged.push({ ...pDoc, _joined: null });
        }
      }
      primaryDocs = merged;
    }

    // Apply limit
    if (spec.limit !== undefined) {
      primaryDocs = primaryDocs.slice(0, spec.limit);
    }

    const result: FederatedQueryResult = {
      rows: primaryDocs,
      sources,
      joinedCount,
      executionTimeMs: performance.now() - start,
    };

    this.eventsSubject.next({
      type: 'query:federated',
      sources,
      rowCount: primaryDocs.length,
    });
    this.statsSubject.next(this.buildStats());

    return result;
  }

  /**
   * Get registry statistics.
   */
  getStats(): RegistryStats {
    return this.buildStats();
  }

  /**
   * Destroy the registry and close all databases.
   */
  async destroy(): Promise<void> {
    for (const entry of this.databases.values()) {
      if (entry.instance.close) {
        await entry.instance.close();
      }
    }
    this.databases.clear();
    this.destroy$.next();
    this.destroy$.complete();
    this.eventsSubject.complete();
    this.statsSubject.complete();
  }

  private buildStats(): RegistryStats {
    return {
      databaseCount: this.databases.size,
      activeDatabases: [...this.databases.values()].filter((d) => d.active).length,
      totalQueries: this.totalQueries,
      totalCollections: 0, // Would require async enumeration
    };
  }
}

export function createDatabaseRegistry(config?: DatabaseRegistryConfig): DatabaseRegistry {
  return new DatabaseRegistry(config);
}
