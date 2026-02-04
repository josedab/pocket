/**
 * View manager for coordinating multiple materialized views.
 *
 * The ViewManager acts as a central registry and router for materialized views.
 * It creates, tracks, and routes change events to the appropriate views based
 * on their source collection.
 *
 * @module view-manager
 */

import { type Observable, Subject, takeUntil } from 'rxjs';
import type { ChangeEvent, Document } from '@pocket/core';
import { MaterializedView } from './materialized-view.js';
import type { ViewDefinition, ViewDelta, ViewEvent, ViewStats } from './types.js';

/**
 * Central manager for materialized views.
 *
 * Maintains a registry of views and efficiently routes change events
 * to the views that need to process them. Views are indexed by their
 * source collection for O(1) routing lookup.
 *
 * @example
 * ```typescript
 * const manager = createViewManager();
 *
 * const view = manager.createView({
 *   name: 'active-users',
 *   collection: 'users',
 *   filter: { status: 'active' },
 *   sort: { name: 'asc' },
 * });
 *
 * // Route change events from the collection
 * manager.processChange('users', changeEvent);
 *
 * // Monitor view events
 * manager.events().subscribe(event => {
 *   console.log(event.type, event.name);
 * });
 * ```
 */
export class ViewManager {
  /** Map of view name -> MaterializedView instance */
  private readonly views = new Map<string, MaterializedView>();

  /** Map of collection name -> Set of view names (for routing) */
  private readonly collectionIndex = new Map<string, Set<string>>();

  /** Subject for emitting view lifecycle and update events */
  private readonly eventSubject = new Subject<ViewEvent>();

  /** Destroy signal for cleanup */
  private readonly destroy$ = new Subject<void>();

  /** Whether the manager has been disposed */
  private disposed = false;

  /**
   * Creates a new materialized view and registers it with the manager.
   *
   * @param definition - The view definition specifying filter, sort, etc.
   * @returns The created MaterializedView instance
   * @throws Error if a view with the same name already exists
   */
  createView<T extends Document>(definition: ViewDefinition<T>): MaterializedView<T> {
    if (this.disposed) {
      throw new Error('ViewManager has been disposed');
    }

    if (this.views.has(definition.name)) {
      throw new Error(`View "${definition.name}" already exists`);
    }

    const view = new MaterializedView<T>(definition);

    // Register in view map
    this.views.set(definition.name, view as unknown as MaterializedView);

    // Index by collection for routing
    let collectionViews = this.collectionIndex.get(definition.collection);
    if (!collectionViews) {
      collectionViews = new Set();
      this.collectionIndex.set(definition.collection, collectionViews);
    }
    collectionViews.add(definition.name);

    // Emit creation event
    this.eventSubject.next({ type: 'view:created', name: definition.name });

    return view;
  }

  /**
   * Drops (removes) a view by name.
   *
   * Disposes the view, removes it from the registry, and emits a drop event.
   *
   * @param name - The name of the view to drop
   * @throws Error if the view does not exist
   */
  dropView(name: string): void {
    const view = this.views.get(name);
    if (!view) {
      throw new Error(`View "${name}" does not exist`);
    }

    // Get collection for index cleanup
    const collection = view.getCollection();

    // Dispose the view
    view.dispose();

    // Remove from registry
    this.views.delete(name);

    // Remove from collection index
    const collectionViews = this.collectionIndex.get(collection);
    if (collectionViews) {
      collectionViews.delete(name);
      if (collectionViews.size === 0) {
        this.collectionIndex.delete(collection);
      }
    }

    // Emit drop event
    this.eventSubject.next({ type: 'view:dropped', name });
  }

  /**
   * Retrieves a view by name.
   *
   * @param name - The view name to look up
   * @returns The MaterializedView instance, or undefined if not found
   */
  getView<T extends Document>(name: string): MaterializedView<T> | undefined {
    return this.views.get(name) as MaterializedView<T> | undefined;
  }

  /**
   * Lists statistics for all registered views.
   *
   * @returns An array of ViewStats for each active view
   */
  listViews(): ViewStats[] {
    const stats: ViewStats[] = [];
    for (const view of this.views.values()) {
      stats.push(view.getStats());
    }
    return stats;
  }

  /**
   * Routes a change event to all views that depend on the specified collection.
   *
   * This is the primary entry point for incremental view maintenance. Each view
   * processes the change independently and the manager emits update events for
   * any views that changed.
   *
   * @param collection - The name of the collection that changed
   * @param change - The change event to process
   */
  processChange(collection: string, change: ChangeEvent<Document>): void {
    if (this.disposed) return;

    const viewNames = this.collectionIndex.get(collection);
    if (!viewNames || viewNames.size === 0) return;

    for (const viewName of viewNames) {
      const view = this.views.get(viewName);
      if (!view) continue;

      const delta = view.applyChange(change) as ViewDelta;

      // Emit update event if the view changed
      if (delta.added.length > 0 || delta.removed.length > 0 || delta.modified.length > 0) {
        this.eventSubject.next({
          type: 'view:updated',
          name: viewName,
          delta,
        });
      }
    }
  }

  /**
   * Returns an Observable of view lifecycle and update events.
   *
   * Events include: view:created, view:updated, view:dropped, view:invalidated
   *
   * @returns An RxJS Observable of ViewEvent
   */
  events(): Observable<ViewEvent> {
    return this.eventSubject.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Disposes of the manager and all registered views.
   *
   * After calling dispose, no further views can be created and no
   * changes will be processed.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Dispose all views
    for (const view of this.views.values()) {
      view.dispose();
    }

    // Clear registries
    this.views.clear();
    this.collectionIndex.clear();

    // Complete event stream
    this.destroy$.next();
    this.destroy$.complete();
    this.eventSubject.complete();
  }
}

/**
 * Factory function to create a new ViewManager instance.
 *
 * @returns A new ViewManager
 *
 * @example
 * ```typescript
 * const manager = createViewManager();
 *
 * manager.createView({
 *   name: 'recent-orders',
 *   collection: 'orders',
 *   filter: { status: { $in: ['pending', 'processing'] } },
 *   sort: { createdAt: 'desc' },
 *   limit: 50,
 * });
 * ```
 */
export function createViewManager(): ViewManager {
  return new ViewManager();
}
