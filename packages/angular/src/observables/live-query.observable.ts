/**
 * RxJS Observables for Pocket in Angular
 *
 * Provides RxJS observable wrappers for Pocket queries.
 *
 * @module @pocket/angular/observables
 */

import type { Collection, Database, Document, QueryBuilder } from '@pocket/core';
import { catchError, Observable, of, shareReplay, startWith, switchMap } from 'rxjs';

/**
 * Live query observable result
 */
export interface LiveQueryObservable<T> {
  /** The query results observable */
  data$: Observable<T[]>;
  /** Loading state observable */
  isLoading$: Observable<boolean>;
  /** Error observable */
  error$: Observable<Error | null>;
  /** Combined state observable */
  state$: Observable<{
    data: T[];
    isLoading: boolean;
    error: Error | null;
  }>;
}

/**
 * Create a live query observable from a Pocket collection.
 *
 * @example
 * ```typescript
 * @Component({
 *   selector: 'app-users',
 *   template: `
 *     <ng-container *ngIf="users$ | async as state">
 *       <p *ngIf="state.isLoading">Loading...</p>
 *       <p *ngIf="state.error">Error: {{ state.error.message }}</p>
 *       <ul>
 *         <li *ngFor="let user of state.data">{{ user.name }}</li>
 *       </ul>
 *     </ng-container>
 *   `
 * })
 * export class UsersComponent {
 *   users$ = fromLiveQuery<User>(this.db, 'users', (q) =>
 *     q.where('active').equals(true)
 *   ).state$;
 *
 *   constructor(private pocket: PocketService) {}
 * }
 * ```
 */
export function fromLiveQuery<T extends Document>(
  db: Database,
  collectionName: string,
  queryFn?: (collection: Collection<T>) => QueryBuilder<T>
): LiveQueryObservable<T> {
  const collection = db.collection<T>(collectionName);
  const builder = queryFn ? queryFn(collection) : collection.find();

  // Main data observable
  const data$ = builder.live().pipe(shareReplay(1));

  // Loading state (starts true, becomes false after first emission)
  const isLoading$ = data$.pipe(
    startWith(null),
    switchMap((val) => of(val === null))
  );

  // Error observable
  const error$ = data$.pipe(
    catchError((err) => of(err instanceof Error ? err : new Error(String(err)))),
    switchMap(() => of<Error | null>(null))
  );

  // Combined state
  const state$ = new Observable<{ data: T[]; isLoading: boolean; error: Error | null }>(
    (subscriber) => {
      let currentData: T[] = [];
      let currentLoading = true;
      let currentError: Error | null = null;

      const emit = () => {
        subscriber.next({
          data: currentData,
          isLoading: currentLoading,
          error: currentError,
        });
      };

      emit(); // Initial state

      const subscription = data$.subscribe({
        next: (results) => {
          currentData = results;
          currentLoading = false;
          currentError = null;
          emit();
        },
        error: (err) => {
          currentError = err instanceof Error ? err : new Error(String(err));
          currentLoading = false;
          emit();
        },
      });

      return () => subscription.unsubscribe();
    }
  ).pipe(shareReplay(1));

  return {
    data$,
    isLoading$,
    error$,
    state$,
  };
}

/**
 * Create an observable for a single document.
 *
 * @example
 * ```typescript
 * user$ = fromDocument<User>(this.db, 'users', this.userId);
 * ```
 */
export function fromDocument<T extends Document>(
  db: Database,
  collectionName: string,
  documentId: string
): Observable<T | null> {
  const collection = db.collection<T>(collectionName);
  return collection.observeById(documentId).pipe(shareReplay(1));
}

/**
 * Create an observable for sync status.
 *
 * @example
 * ```typescript
 * syncStatus$ = fromSyncStatus(this.db);
 *
 * // In template:
 * <p *ngIf="(syncStatus$ | async)?.isSyncing">Syncing...</p>
 * ```
 */
export function fromSyncStatus(_db: Database): Observable<{
  isConnected: boolean;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  pendingChanges: number;
  error: Error | null;
}> {
  // Placeholder implementation
  // Would connect to actual sync status observable from database
  return of({
    isConnected: false,
    isSyncing: false,
    lastSyncAt: null,
    pendingChanges: 0,
    error: null,
  });
}

/**
 * Operator to transform a live query into paginated results.
 *
 * @example
 * ```typescript
 * users$ = fromLiveQuery<User>(db, 'users').data$.pipe(
 *   paginateResults(10) // 10 items per page
 * );
 * ```
 */
export function paginateResults<T>(
  pageSize: number,
  page = 0
): (
  source: Observable<T[]>
) => Observable<{ data: T[]; total: number; page: number; pages: number }> {
  return (source: Observable<T[]>) =>
    source.pipe(
      switchMap((results) => {
        const total = results.length;
        const pages = Math.ceil(total / pageSize);
        const start = page * pageSize;
        const end = start + pageSize;
        const data = results.slice(start, end);

        return of({ data, total, page, pages });
      })
    );
}

/**
 * Operator to filter query results client-side.
 *
 * @example
 * ```typescript
 * activeUsers$ = fromLiveQuery<User>(db, 'users').data$.pipe(
 *   filterResults<User>((user) => user.active)
 * );
 * ```
 */
export function filterResults<T>(
  predicate: (item: T) => boolean
): (source: Observable<T[]>) => Observable<T[]> {
  return (source: Observable<T[]>) =>
    source.pipe(switchMap((results) => of(results.filter(predicate))));
}

/**
 * Operator to sort query results client-side.
 *
 * @example
 * ```typescript
 * sortedUsers$ = fromLiveQuery<User>(db, 'users').data$.pipe(
 *   sortResults<User>('name', 'asc')
 * );
 * ```
 */
export function sortResults<T>(
  field: keyof T,
  direction: 'asc' | 'desc' = 'asc'
): (source: Observable<T[]>) => Observable<T[]> {
  return (source: Observable<T[]>) =>
    source.pipe(
      switchMap((results) => {
        const sorted = [...results].sort((a, b) => {
          const aVal = a[field];
          const bVal = b[field];

          if (aVal < bVal) return direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return direction === 'asc' ? 1 : -1;
          return 0;
        });

        return of(sorted);
      })
    );
}
