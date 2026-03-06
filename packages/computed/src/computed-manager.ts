/**
 * @pocket/computed — Manager for multiple reactive computed collections.
 *
 * Handles dependency graphs between computed collections, orchestrates
 * lifecycle, and provides a unified event stream.
 *
 * @module @pocket/computed
 */

import { BehaviorSubject, type Observable, Subject, type Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ComputedCollection, createComputedCollection } from './computed-collection.js';
import type {
  ComputedCollectionConfig,
  ComputedCollectionState,
  ComputedEvent,
  SourceCollection,
} from './types.js';

// ── Types ─────────────────────────────────────────────────

export interface ComputedManagerState {
  collections: Record<string, ComputedCollectionState>;
  totalComputations: number;
  sourceCount: number;
}

// ── Dependency Graph ──────────────────────────────────────

class DependencyGraph {
  private readonly edges = new Map<string, Set<string>>();

  addDependency(from: string, to: string): void {
    if (!this.edges.has(from)) {
      this.edges.set(from, new Set());
    }
    this.edges.get(from)!.add(to);
  }

  getDependencies(name: string): string[] {
    return Array.from(this.edges.get(name) ?? []);
  }

  getDependents(name: string): string[] {
    const dependents: string[] = [];
    for (const [from, deps] of this.edges) {
      if (deps.has(name)) dependents.push(from);
    }
    return dependents;
  }

  /** Topological sort — throws on cycles */
  topologicalSort(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (node: string): void => {
      if (visited.has(node)) return;
      if (visiting.has(node)) {
        throw new Error(`Circular dependency detected involving "${node}"`);
      }
      visiting.add(node);
      for (const dep of this.getDependencies(node)) {
        visit(dep);
      }
      visiting.delete(node);
      visited.add(node);
      result.push(node);
    };

    for (const node of this.edges.keys()) {
      visit(node);
    }

    return result;
  }
}

// ── Computed Manager ──────────────────────────────────────

/**
 * Manages a graph of reactive computed collections.
 */
export class ComputedManager {
  private readonly sources = new Map<string, SourceCollection>();
  private readonly computed = new Map<string, ComputedCollection>();
  private readonly graph = new DependencyGraph();
  private readonly destroy$ = new Subject<void>();
  private readonly events$$ = new Subject<ComputedEvent>();
  private readonly state$$: BehaviorSubject<ComputedManagerState>;
  private readonly subscriptions = new Map<string, Subscription>();
  private totalComputations = 0;

  readonly events$ = this.events$$.asObservable();

  constructor() {
    this.state$$ = new BehaviorSubject<ComputedManagerState>({
      collections: {},
      totalComputations: 0,
      sourceCount: 0,
    });
  }

  get state$(): Observable<ComputedManagerState> {
    return this.state$$.asObservable();
  }

  /** Register a source collection */
  registerSource(source: SourceCollection): void {
    this.sources.set(source.name, source);
    this.updateState();
  }

  /** Register multiple source collections */
  registerSources(sources: SourceCollection[]): void {
    for (const s of sources) {
      this.sources.set(s.name, s);
    }
    this.updateState();
  }

  /**
   * Define and register a computed collection.
   * Automatically resolves dependencies and binds to sources.
   */
  addComputed<T extends Record<string, unknown> = Record<string, unknown>>(
    config: ComputedCollectionConfig<T>,
  ): ComputedCollection<T> {
    if (this.computed.has(config.name)) {
      throw new Error(`Computed collection "${config.name}" already exists`);
    }

    // Register dependencies
    for (const sourceName of config.sources) {
      this.graph.addDependency(config.name, sourceName);
    }

    // Validate no cycles
    try {
      this.graph.topologicalSort();
    } catch (err) {
      throw new Error(`Cannot add "${config.name}": ${(err as Error).message}`);
    }

    const collection = createComputedCollection(config);
    this.computed.set(config.name, collection as ComputedCollection);

    // Forward events
    const sub = collection.events$.pipe(takeUntil(this.destroy$)).subscribe((event) => {
      this.events$$.next(event);
      if (event.type === 'computed') {
        this.totalComputations++;
      }
      this.updateState();
    });
    this.subscriptions.set(config.name, sub);

    // Bind if all sources are available
    this.tryBind(config.name);

    // Also register this computed collection as a source for downstream
    this.sources.set(config.name, {
      name: config.name,
      documents$: collection.documents$ as Observable<Record<string, unknown>[]>,
      getAll: () => collection.getAll() as Record<string, unknown>[],
    });

    this.updateState();
    return collection;
  }

  /** Get a computed collection by name */
  getComputed<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
  ): ComputedCollection<T> | undefined {
    return this.computed.get(name) as ComputedCollection<T> | undefined;
  }

  /** Remove a computed collection */
  removeComputed(name: string): void {
    const collection = this.computed.get(name);
    if (!collection) return;

    // Check for dependents
    const dependents = this.graph.getDependents(name);
    if (dependents.length > 0) {
      throw new Error(`Cannot remove "${name}": depended on by ${dependents.join(', ')}`);
    }

    collection.dispose();
    this.computed.delete(name);
    this.sources.delete(name);
    this.subscriptions.get(name)?.unsubscribe();
    this.subscriptions.delete(name);
    this.updateState();
  }

  /** Invalidate a computed collection and its dependents */
  invalidate(name: string): void {
    const collection = this.computed.get(name);
    if (collection) {
      collection.invalidate('cascade');
    }

    for (const dep of this.graph.getDependents(name)) {
      this.invalidate(dep);
    }
  }

  /** Get all computed collection names */
  getComputedNames(): string[] {
    return Array.from(this.computed.keys());
  }

  /** Get state snapshot */
  getState(): ComputedManagerState {
    return this.state$$.getValue();
  }

  /** Dispose of all computed collections */
  dispose(): void {
    for (const collection of this.computed.values()) {
      collection.dispose();
    }
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.computed.clear();
    this.subscriptions.clear();
    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.complete();
    this.state$$.complete();
  }

  private tryBind(name: string): void {
    const deps = this.graph.getDependencies(name);
    const allAvailable = deps.every((d) => this.sources.has(d));
    if (allAvailable) {
      const collection = this.computed.get(name);
      if (collection) {
        collection.bind(this.sources);
      }
    }
  }

  private updateState(): void {
    const collections: Record<string, ComputedCollectionState> = {};
    for (const [name, col] of this.computed) {
      collections[name] = col.getState();
    }
    this.state$$.next({
      collections,
      totalComputations: this.totalComputations,
      sourceCount: this.sources.size,
    });
  }
}

// ── Factory ───────────────────────────────────────────────

export function createComputedManager(): ComputedManager {
  return new ComputedManager();
}
