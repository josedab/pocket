import { BehaviorSubject } from 'rxjs';
import type {
  ChangeEvent,
  MaterializedView,
  ViewDefinition,
  ViewManagerConfig,
} from './types.js';
import { createDependencyGraph } from './dependency-graph.js';

interface ViewEntry<T, R> {
  definition: ViewDefinition<T, R>;
  documents: Map<string, T>;
  subject: BehaviorSubject<R>;
  changeCount: number;
}

/** Creates a view engine that manages materialized views with incremental updates */
export function createViewEngine(config: ViewManagerConfig = {}) {
  const views = new Map<string, ViewEntry<unknown, unknown>>();
  const graph = createDependencyGraph();
  let refreshInterval: ReturnType<typeof setInterval> | undefined;

  if (config.autoRefresh && config.refreshIntervalMs) {
    refreshInterval = setInterval(() => {
      for (const entry of views.values()) {
        recompute(entry);
      }
    }, config.refreshIntervalMs);
  }

  function recompute<T, R>(entry: ViewEntry<T, R>): void {
    let docs = Array.from(entry.documents.values());
    if (entry.definition.filter) {
      docs = docs.filter(entry.definition.filter);
    }
    const result = entry.definition.mapFn(docs);
    entry.subject.next(result);
  }

  function define<T, R>(definition: ViewDefinition<T, R>): MaterializedView<R> {
    if (config.maxViews && views.size >= config.maxViews) {
      throw new Error(`Maximum number of views (${config.maxViews}) reached`);
    }

    const subject = new BehaviorSubject<R>(definition.mapFn([]));
    const entry: ViewEntry<T, R> = {
      definition,
      documents: new Map(),
      subject,
      changeCount: 0,
    };

    views.set(definition.name, entry as ViewEntry<unknown, unknown>);
    graph.addNode(definition.sourceCollection);
    graph.addEdge(definition.sourceCollection, definition.name);

    return createMaterializedView(definition.name, entry);
  }

  function createMaterializedView<T, R>(
    name: string,
    entry: ViewEntry<T, R>,
  ): MaterializedView<R> {
    return {
      name,
      value$: entry.subject.asObservable(),
      getValue: () => entry.subject.getValue(),
      refresh: () => recompute(entry),
      destroy: () => removeView(name),
    };
  }

  function processChange<T>(event: ChangeEvent<T>): void {
    for (const [, entry] of views) {
      const typedEntry = entry as ViewEntry<T, unknown>;
      if (typedEntry.definition.sourceCollection !== event.collection) continue;

      const docId =
        (event.document as Record<string, unknown>)._id as string ??
        String(Date.now());

      switch (event.type) {
        case 'insert':
          typedEntry.documents.set(docId, event.document);
          break;
        case 'update':
          typedEntry.documents.set(docId, event.document);
          break;
        case 'delete':
          typedEntry.documents.delete(docId);
          break;
      }

      typedEntry.changeCount++;
      recompute(typedEntry);
    }
  }

  function getView<R>(name: string): MaterializedView<R> | undefined {
    const entry = views.get(name);
    if (!entry) return undefined;
    return createMaterializedView(name, entry) as MaterializedView<R>;
  }

  function getAllViews(): MaterializedView<unknown>[] {
    const result: MaterializedView<unknown>[] = [];
    for (const [name, entry] of views) {
      result.push(createMaterializedView(name, entry));
    }
    return result;
  }

  function removeView(name: string): void {
    const entry = views.get(name);
    if (entry) {
      entry.subject.complete();
      views.delete(name);
      graph.removeNode(name);
    }
  }

  function destroy(): void {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = undefined;
    }
    for (const [, entry] of views) {
      entry.subject.complete();
    }
    views.clear();
  }

  return {
    define,
    processChange,
    getView,
    getAllViews,
    removeView,
    destroy,
  };
}
