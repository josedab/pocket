/**
 * Navigation Flow Collector — tracks user navigation patterns
 * and page transitions to improve prefetch predictions.
 *
 * Records which queries occur on which pages/routes, enabling
 * route-based prefetching: when a user navigates to a page,
 * we know which queries to prefetch in advance.
 *
 * @module @pocket/prefetch/navigation-collector
 */

import type { Observable } from 'rxjs';
import { BehaviorSubject, Subject } from 'rxjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavigationEvent {
  readonly route: string;
  readonly timestamp: number;
  readonly referrer: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface RouteQueryAssociation {
  readonly route: string;
  readonly queryKey: string;
  readonly collection: string;
  readonly filter: Record<string, unknown>;
  readonly frequency: number;
  readonly avgLatencyMs: number;
  readonly lastSeen: number;
}

export interface NavigationTransition {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly probability: number;
}

export interface NavigationCollectorConfig {
  /** Maximum routes to track. */
  readonly maxRoutes?: number;
  /** Maximum transitions to track. */
  readonly maxTransitions?: number;
  /** Minimum frequency before a route-query is considered stable. */
  readonly minFrequency?: number;
  /** Decay factor for old patterns (0-1, lower = faster decay). */
  readonly decayFactor?: number;
}

export interface NavigationCollectorState {
  readonly currentRoute: string | null;
  readonly routeCount: number;
  readonly transitionCount: number;
  readonly associationCount: number;
  readonly totalNavigations: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class NavigationFlowCollector {
  private readonly config: Required<NavigationCollectorConfig>;
  private readonly stateSubject: BehaviorSubject<NavigationCollectorState>;
  private readonly predictionSubject = new Subject<{
    route: string;
    queries: RouteQueryAssociation[];
  }>();

  private currentRoute: string | null = null;
  private readonly routeQueries = new Map<string, Map<string, RouteQueryAssociation>>();
  private readonly transitions = new Map<string, NavigationTransition>();
  private readonly routeVisits = new Map<string, number>();
  private totalNavigations = 0;

  constructor(config?: NavigationCollectorConfig) {
    this.config = {
      maxRoutes: config?.maxRoutes ?? 200,
      maxTransitions: config?.maxTransitions ?? 500,
      minFrequency: config?.minFrequency ?? 2,
      decayFactor: config?.decayFactor ?? 0.95,
    };

    this.stateSubject = new BehaviorSubject<NavigationCollectorState>({
      currentRoute: null,
      routeCount: 0,
      transitionCount: 0,
      associationCount: 0,
      totalNavigations: 0,
    });
  }

  /** Observable of collector state. */
  get state$(): Observable<NavigationCollectorState> {
    return this.stateSubject.asObservable();
  }

  /** Observable of prefetch predictions when navigation occurs. */
  get predictions$(): Observable<{ route: string; queries: RouteQueryAssociation[] }> {
    return this.predictionSubject.asObservable();
  }

  /**
   * Record a navigation event (user navigated to a new route).
   * Returns predicted queries for the new route.
   */
  recordNavigation(route: string): RouteQueryAssociation[] {
    const previousRoute = this.currentRoute;
    this.currentRoute = route;
    this.totalNavigations++;

    // Track route visits
    this.routeVisits.set(route, (this.routeVisits.get(route) ?? 0) + 1);

    // Track transition
    if (previousRoute && previousRoute !== route) {
      const transKey = `${previousRoute}->${route}`;
      const existing = this.transitions.get(transKey);
      if (existing) {
        this.transitions.set(transKey, {
          ...existing,
          count: existing.count + 1,
          probability: 0, // Recalculated below
        });
      } else {
        if (this.transitions.size >= this.config.maxTransitions) {
          // Evict least-used transition
          const leastUsed = Array.from(this.transitions.entries()).sort(
            ([, a], [, b]) => a.count - b.count
          )[0];
          if (leastUsed) {
            this.transitions.delete(leastUsed[0]);
          }
        }
        this.transitions.set(transKey, {
          from: previousRoute,
          to: route,
          count: 1,
          probability: 0,
        });
      }

      // Recalculate probabilities for transitions from previousRoute
      this.recalculateTransitionProbabilities(previousRoute);
    }

    // Get predicted queries for this route
    const predictions = this.getPredictedQueries(route);

    this.updateState();

    if (predictions.length > 0) {
      this.predictionSubject.next({ route, queries: predictions });
    }

    return predictions;
  }

  /**
   * Record a query that occurred on the current route.
   */
  recordQuery(collection: string, filter: Record<string, unknown>, latencyMs: number): void {
    if (!this.currentRoute) return;

    const queryKey = this.hashQuery(collection, filter);
    const routeMap =
      this.routeQueries.get(this.currentRoute) ?? new Map<string, RouteQueryAssociation>();

    const existing = routeMap.get(queryKey);
    if (existing) {
      const newFreq = existing.frequency + 1;
      const newAvg = (existing.avgLatencyMs * existing.frequency + latencyMs) / newFreq;
      routeMap.set(queryKey, {
        ...existing,
        frequency: newFreq,
        avgLatencyMs: Math.round(newAvg * 100) / 100,
        lastSeen: Date.now(),
      });
    } else {
      routeMap.set(queryKey, {
        route: this.currentRoute,
        queryKey,
        collection,
        filter,
        frequency: 1,
        avgLatencyMs: latencyMs,
        lastSeen: Date.now(),
      });
    }

    this.routeQueries.set(this.currentRoute, routeMap);
    this.updateState();
  }

  /**
   * Get predicted queries for a route based on historical associations.
   */
  getPredictedQueries(route: string): RouteQueryAssociation[] {
    const routeMap = this.routeQueries.get(route);
    if (!routeMap) return [];

    return Array.from(routeMap.values())
      .filter((a) => a.frequency >= this.config.minFrequency)
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get likely next routes from the current route (for deeper prefetching).
   */
  getPredictedNextRoutes(fromRoute?: string): NavigationTransition[] {
    const from = fromRoute ?? this.currentRoute;
    if (!from) return [];

    return Array.from(this.transitions.values())
      .filter((t) => t.from === from)
      .sort((a, b) => b.probability - a.probability);
  }

  /**
   * Get all route-query associations.
   */
  getAllAssociations(): RouteQueryAssociation[] {
    const all: RouteQueryAssociation[] = [];
    for (const routeMap of this.routeQueries.values()) {
      all.push(...routeMap.values());
    }
    return all;
  }

  /**
   * Apply decay to old patterns (call periodically).
   */
  applyDecay(): void {
    for (const [route, queryMap] of this.routeQueries.entries()) {
      for (const [key, assoc] of queryMap.entries()) {
        const decayed = Math.floor(assoc.frequency * this.config.decayFactor);
        if (decayed <= 0) {
          queryMap.delete(key);
        } else {
          queryMap.set(key, { ...assoc, frequency: decayed });
        }
      }
      if (queryMap.size === 0) {
        this.routeQueries.delete(route);
      }
    }
    this.updateState();
  }

  /** Reset all collected data. */
  reset(): void {
    this.routeQueries.clear();
    this.transitions.clear();
    this.routeVisits.clear();
    this.currentRoute = null;
    this.totalNavigations = 0;
    this.updateState();
  }

  destroy(): void {
    this.stateSubject.complete();
    this.predictionSubject.complete();
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private hashQuery(collection: string, filter: Record<string, unknown>): string {
    return `${collection}:${JSON.stringify(filter, Object.keys(filter).sort())}`;
  }

  private recalculateTransitionProbabilities(fromRoute: string): void {
    const fromTransitions = Array.from(this.transitions.values()).filter(
      (t) => t.from === fromRoute
    );
    const totalCount = fromTransitions.reduce((sum, t) => sum + t.count, 0);

    for (const t of fromTransitions) {
      const key = `${t.from}->${t.to}`;
      this.transitions.set(key, {
        ...t,
        probability: totalCount > 0 ? Math.round((t.count / totalCount) * 1000) / 1000 : 0,
      });
    }
  }

  private updateState(): void {
    let associations = 0;
    for (const routeMap of this.routeQueries.values()) {
      associations += routeMap.size;
    }

    this.stateSubject.next({
      currentRoute: this.currentRoute,
      routeCount: this.routeQueries.size,
      transitionCount: this.transitions.size,
      associationCount: associations,
      totalNavigations: this.totalNavigations,
    });
  }
}

export function createNavigationCollector(
  config?: NavigationCollectorConfig
): NavigationFlowCollector {
  return new NavigationFlowCollector(config);
}
