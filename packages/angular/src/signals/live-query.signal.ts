/**
 * Angular Signals for Pocket (Angular 16+)
 *
 * Provides reactive signals for Pocket queries using Angular's new Signals API.
 *
 * @module @pocket/angular/signals
 */

import type { Signal, WritableSignal } from '@angular/core';
import type { Collection, Database, Document, QueryBuilder } from '@pocket/core';

/**
 * Live query signal result
 */
export interface LiveQuerySignal<T> {
  /** The query results as a signal */
  data: Signal<T[]>;
  /** Loading state signal */
  isLoading: Signal<boolean>;
  /** Error state signal */
  error: Signal<Error | null>;
  /** Refresh the query */
  refresh: () => void;
  /** Cleanup subscription */
  destroy: () => void;
}

/**
 * Live document signal result
 */
export interface LiveDocumentSignal<T> {
  /** The document as a signal */
  data: Signal<T | null>;
  /** Loading state signal */
  isLoading: Signal<boolean>;
  /** Error state signal */
  error: Signal<Error | null>;
  /** Cleanup subscription */
  destroy: () => void;
}

/**
 * Sync status signal result
 */
export interface SyncStatusSignal {
  /** Whether sync is connected */
  isConnected: Signal<boolean>;
  /** Whether sync is active */
  isSyncing: Signal<boolean>;
  /** Last sync timestamp */
  lastSyncAt: Signal<Date | null>;
  /** Pending changes count */
  pendingChanges: Signal<number>;
  /** Sync error */
  error: Signal<Error | null>;
}

/**
 * Create a live query signal that updates when data changes.
 *
 * @example
 * ```typescript
 * @Component({
 *   selector: 'app-users',
 *   template: `
 *     @if (users.isLoading()) {
 *       <p>Loading...</p>
 *     }
 *     @for (user of users.data(); track user._id) {
 *       <div>{{ user.name }}</div>
 *     }
 *   `
 * })
 * export class UsersComponent implements OnDestroy {
 *   users = liveQuery<User>(this.db, 'users', (q) =>
 *     q.where('active').equals(true)
 *   );
 *
 *   constructor(private pocket: PocketService) {}
 *
 *   ngOnDestroy() {
 *     this.users.destroy();
 *   }
 * }
 * ```
 */
export function liveQuery<T extends Document>(
  db: Database,
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>
): LiveQuerySignal<T> {
  // Dynamic import for Angular signals to support different versions
  let signal: <T>(value: T) => WritableSignal<T>;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const angular = require('@angular/core');
    signal = angular.signal;
  } catch {
    // Fallback: create a simple signal-like function with methods
    signal = <S>(value: S): WritableSignal<S> => {
      let current = value;
      const fn = (() => current) as WritableSignal<S>;
      fn.set = (v: S) => {
        current = v;
      };
      fn.update = (updateFn: (v: S) => S) => {
        current = updateFn(current);
      };
      fn.asReadonly = () => fn;
      return fn;
    };
  }

  const data = signal<T[]>([]);
  const isLoading = signal(true);
  const error = signal<Error | null>(null);

  let subscription: { unsubscribe: () => void } | null = null;

  const subscribe = () => {
    const collection = db.collection<T>(collectionName);
    const builder = queryFn ? queryFn(collection) : collection.find();

    isLoading.set(true);

    subscription = builder.live().subscribe({
      next: (results) => {
        data.set(results);
        isLoading.set(false);
        error.set(null);
      },
      error: (err) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
        isLoading.set(false);
      },
    });
  };

  subscribe();

  return {
    data: data as Signal<T[]>,
    isLoading: isLoading as Signal<boolean>,
    error: error as Signal<Error | null>,
    refresh: () => {
      if (subscription) {
        subscription.unsubscribe();
      }
      subscribe();
    },
    destroy: () => {
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }
    },
  };
}

/**
 * Create a live document signal that updates when the document changes.
 *
 * @example
 * ```typescript
 * user = liveDocument<User>(this.db, 'users', this.userId);
 * ```
 */
export function liveDocument<T extends Document>(
  db: Database,
  collectionName: string,
  documentId: string
): LiveDocumentSignal<T> {
  // Dynamic import for Angular signals
  let signal: <T>(value: T) => WritableSignal<T>;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const angular = require('@angular/core');
    signal = angular.signal;
  } catch {
    signal = <S>(value: S): WritableSignal<S> => {
      let current = value;
      const fn = (() => current) as WritableSignal<S>;
      fn.set = (v: S) => {
        current = v;
      };
      fn.update = (updateFn: (v: S) => S) => {
        current = updateFn(current);
      };
      fn.asReadonly = () => fn;
      return fn;
    };
  }

  const data = signal<T | null>(null);
  const isLoading = signal(true);
  const error = signal<Error | null>(null);

  const collection = db.collection<T>(collectionName);
  const subscription = collection.observeById(documentId).subscribe({
    next: (doc) => {
      data.set(doc);
      isLoading.set(false);
      error.set(null);
    },
    error: (err) => {
      error.set(err instanceof Error ? err : new Error(String(err)));
      isLoading.set(false);
    },
  });

  return {
    data: data as Signal<T | null>,
    isLoading: isLoading as Signal<boolean>,
    error: error as Signal<Error | null>,
    destroy: () => {
      subscription.unsubscribe();
    },
  };
}

/**
 * Create a sync status signal.
 *
 * @example
 * ```typescript
 * sync = syncStatus(this.db);
 *
 * // In template:
 * @if (sync.isSyncing()) {
 *   <p>Syncing...</p>
 * }
 * ```
 */
export function syncStatus(db: Database): SyncStatusSignal {
  let signal: <T>(value: T) => WritableSignal<T>;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const angular = require('@angular/core');
    signal = angular.signal;
  } catch {
    signal = <S>(value: S): WritableSignal<S> => {
      let current = value;
      const fn = (() => current) as WritableSignal<S>;
      fn.set = (v: S) => {
        current = v;
      };
      fn.update = (updateFn: (v: S) => S) => {
        current = updateFn(current);
      };
      fn.asReadonly = () => fn;
      return fn;
    };
  }

  const isConnected = signal(false);
  const isSyncing = signal(false);
  const lastSyncAt = signal<Date | null>(null);
  const pendingChanges = signal(0);
  const error = signal<Error | null>(null);

  // Would connect to actual sync status from database
  // This is a placeholder implementation
  void db;

  return {
    isConnected: isConnected as Signal<boolean>,
    isSyncing: isSyncing as Signal<boolean>,
    lastSyncAt: lastSyncAt as Signal<Date | null>,
    pendingChanges: pendingChanges as Signal<number>,
    error: error as Signal<Error | null>,
  };
}
