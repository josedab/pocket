/**
 * Conflict Manager - Manages conflict detection, storage, and resolution
 */

import type { Document } from '@pocket/core';
import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import { ConflictAnalyzer } from './conflict-analyzer.js';
import type {
  AutoResolutionRule,
  Conflict,
  ConflictEvent,
  ConflictResolution,
  ConflictResolutionConfig,
  ConflictState,
  ConflictType,
  ResolutionStrategy,
} from './types.js';
import { DEFAULT_CONFLICT_CONFIG } from './types.js';

/**
 * Generates a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Manages conflicts throughout the sync lifecycle
 */
export class ConflictManager {
  private readonly config: Required<
    Omit<ConflictResolutionConfig, 'onConflict' | 'onResolution' | 'autoResolutionRules'>
  > &
    Pick<ConflictResolutionConfig, 'onConflict' | 'onResolution'>;
  private readonly analyzer: ConflictAnalyzer;
  private readonly conflicts = new Map<string, Conflict>();
  private readonly resolutionHistory: ConflictResolution[] = [];
  private readonly autoResolutionRules: AutoResolutionRule[] = [];

  private readonly state$ = new BehaviorSubject<ConflictState>({
    conflicts: [],
    selectedConflictId: null,
    resolutionHistory: [],
    autoResolutionRules: [],
  });

  private readonly events$ = new Subject<ConflictEvent>();

  constructor(config: ConflictResolutionConfig = {}) {
    this.config = { ...DEFAULT_CONFLICT_CONFIG, ...config };
    this.analyzer = new ConflictAnalyzer();

    if (config.autoResolutionRules) {
      for (const rule of config.autoResolutionRules) {
        this.autoResolutionRules.push(rule);
      }
    }

    this.updateState();
  }

  /**
   * Register a new conflict
   */
  registerConflict<T extends Document>(
    type: ConflictType,
    collection: string,
    documentId: string,
    local: T | null,
    remote: T | null,
    base: T | null = null,
    syncSessionId?: string
  ): Conflict<T> {
    const conflict: Conflict<T> = {
      id: generateId(),
      type,
      collection,
      documentId,
      local,
      remote,
      base,
      detectedAt: Date.now(),
      syncSessionId,
    };

    // Check for auto-resolution
    if (this.config.autoResolve) {
      const resolution = this.tryAutoResolve(conflict);
      if (resolution) {
        return conflict;
      }
    }

    this.conflicts.set(conflict.id, conflict);

    // Enforce max conflicts
    while (this.conflicts.size > this.config.maxConflicts) {
      const oldest = Array.from(this.conflicts.keys())[0];
      if (oldest) {
        this.conflicts.delete(oldest);
      }
    }

    this.updateState();
    this.emitEvent('conflict_detected', { conflict });
    this.config.onConflict?.(conflict);

    return conflict;
  }

  /**
   * Try to auto-resolve a conflict using rules
   */
  private tryAutoResolve<T extends Document>(conflict: Conflict<T>): ConflictResolution<T> | null {
    // Sort rules by priority (highest first)
    const sortedRules = [...this.autoResolutionRules]
      .filter((r) => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      // Check if rule applies to this collection
      if (rule.collections.length > 0 && !rule.collections.includes(conflict.collection)) {
        continue;
      }

      // Check if rule applies to this conflict type
      if (!rule.conflictTypes.includes(conflict.type)) {
        continue;
      }

      // Check custom condition
      if (rule.condition && !rule.condition(conflict)) {
        continue;
      }

      // Apply the rule
      const resolution = this.applyStrategy(conflict, rule.strategy);
      if (resolution) {
        resolution.resolvedBy = `auto:${rule.id}`;
        this.recordResolution(resolution);
        this.emitEvent('conflict_auto_resolved', { conflict, rule, resolution });
        return resolution;
      }
    }

    return null;
  }

  /**
   * Apply a resolution strategy to a conflict
   */
  private applyStrategy<T extends Document>(
    conflict: Conflict<T>,
    strategy: ResolutionStrategy
  ): ConflictResolution<T> | null {
    let resolvedDocument: T | null = null;
    let deleteDocument = false;

    switch (strategy) {
      case 'keep_local':
        resolvedDocument = conflict.local;
        deleteDocument = conflict.local === null;
        break;

      case 'keep_remote':
        resolvedDocument = conflict.remote;
        deleteDocument = conflict.remote === null;
        break;

      case 'timestamp':
        resolvedDocument = this.analyzer.mergeByTimestamp(conflict);
        deleteDocument = resolvedDocument === null;
        break;

      case 'version':
        resolvedDocument = this.analyzer.mergeByVersion(conflict);
        deleteDocument = resolvedDocument === null;
        break;

      case 'merge': {
        const mergeResult = this.analyzer.threeWayMerge(conflict);
        if (mergeResult.success) {
          resolvedDocument = mergeResult.merged ?? null;
        } else {
          // Can't auto-merge
          return null;
        }
        break;
      }

      case 'manual':
      case 'custom':
      case 'keep_both':
        // These require manual intervention
        return null;
    }

    return {
      conflictId: conflict.id,
      strategy,
      resolvedDocument,
      deleteDocument,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Resolve a conflict manually
   */
  resolve<T extends Document>(
    conflictId: string,
    strategy: ResolutionStrategy,
    resolvedDocument: T | null,
    deleteDocument = false,
    resolvedBy?: string,
    notes?: string
  ): ConflictResolution<T> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }

    const resolution: ConflictResolution<T> = {
      conflictId,
      strategy,
      resolvedDocument,
      deleteDocument,
      resolvedBy,
      resolvedAt: Date.now(),
      notes,
    };

    this.recordResolution(resolution);
    this.conflicts.delete(conflictId);
    this.updateState();
    this.emitEvent('conflict_resolved', { conflict, resolution });
    this.config.onResolution?.(resolution);

    return resolution;
  }

  /**
   * Resolve using a specific strategy
   */
  resolveWithStrategy<T extends Document>(
    conflictId: string,
    strategy: Exclude<ResolutionStrategy, 'custom' | 'manual'>,
    resolvedBy?: string
  ): ConflictResolution<T> | null {
    const conflict = this.conflicts.get(conflictId) as Conflict<T> | undefined;
    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }

    const resolution = this.applyStrategy(conflict, strategy);
    if (!resolution) {
      return null;
    }

    resolution.resolvedBy = resolvedBy;
    this.recordResolution(resolution);
    this.conflicts.delete(conflictId);
    this.updateState();
    this.emitEvent('conflict_resolved', { conflict, resolution });
    this.config.onResolution?.(resolution);

    return resolution;
  }

  /**
   * Resolve with custom merge
   */
  resolveWithCustomMerge<T extends Document>(
    conflictId: string,
    fieldSelections: Record<string, 'local' | 'remote' | 'base'>,
    resolvedBy?: string
  ): ConflictResolution<T> {
    const conflict = this.conflicts.get(conflictId) as Conflict<T> | undefined;
    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }

    const merged = this.analyzer.customMerge(conflict, fieldSelections);

    const resolution: ConflictResolution<T> = {
      conflictId,
      strategy: 'custom',
      resolvedDocument: merged,
      deleteDocument: merged === null,
      resolvedBy,
      resolvedAt: Date.now(),
    };

    this.recordResolution(resolution);
    this.conflicts.delete(conflictId);
    this.updateState();
    this.emitEvent('conflict_resolved', { conflict, resolution });
    this.config.onResolution?.(resolution);

    return resolution;
  }

  /**
   * Record a resolution in history
   */
  private recordResolution(resolution: ConflictResolution): void {
    if (!this.config.keepHistory) return;

    this.resolutionHistory.push(resolution);

    // Enforce max history size
    while (this.resolutionHistory.length > this.config.maxHistorySize) {
      this.resolutionHistory.shift();
    }
  }

  /**
   * Get a conflict by ID
   */
  getConflict<T extends Document>(id: string): Conflict<T> | undefined {
    return this.conflicts.get(id) as Conflict<T> | undefined;
  }

  /**
   * Get all conflicts
   */
  getConflicts(): Conflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Get conflicts for a specific collection
   */
  getConflictsByCollection(collection: string): Conflict[] {
    return this.getConflicts().filter((c) => c.collection === collection);
  }

  /**
   * Get conflicts for a specific document
   */
  getConflictsByDocument(collection: string, documentId: string): Conflict[] {
    return this.getConflicts().filter(
      (c) => c.collection === collection && c.documentId === documentId
    );
  }

  /**
   * Check if there are any pending conflicts
   */
  hasConflicts(): boolean {
    return this.conflicts.size > 0;
  }

  /**
   * Get conflict count
   */
  getConflictCount(): number {
    return this.conflicts.size;
  }

  /**
   * Analyze a conflict
   */
  analyzeConflict<T extends Document>(conflictId: string) {
    const conflict = this.conflicts.get(conflictId) as Conflict<T> | undefined;
    if (!conflict) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }

    return this.analyzer.analyze(conflict);
  }

  /**
   * Add an auto-resolution rule
   */
  addRule(rule: AutoResolutionRule): void {
    this.autoResolutionRules.push(rule);
    this.updateState();
    this.emitEvent('rule_added', { rule });
  }

  /**
   * Remove an auto-resolution rule
   */
  removeRule(ruleId: string): void {
    const index = this.autoResolutionRules.findIndex((r) => r.id === ruleId);
    if (index >= 0) {
      const rule = this.autoResolutionRules.splice(index, 1)[0];
      this.updateState();
      this.emitEvent('rule_removed', { rule });
    }
  }

  /**
   * Get auto-resolution rules
   */
  getRules(): AutoResolutionRule[] {
    return [...this.autoResolutionRules];
  }

  /**
   * Get resolution history
   */
  getResolutionHistory(): ConflictResolution[] {
    return [...this.resolutionHistory];
  }

  /**
   * Clear all conflicts
   */
  clearConflicts(): void {
    this.conflicts.clear();
    this.updateState();
    this.emitEvent('conflicts_cleared');
  }

  /**
   * Clear resolution history
   */
  clearHistory(): void {
    this.resolutionHistory.length = 0;
    this.updateState();
  }

  /**
   * Get state observable
   */
  get state(): Observable<ConflictState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state
   */
  getCurrentState(): ConflictState {
    return this.state$.value;
  }

  /**
   * Get events observable
   */
  get events(): Observable<ConflictEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get the analyzer instance
   */
  getAnalyzer(): ConflictAnalyzer {
    return this.analyzer;
  }

  /**
   * Update state
   */
  private updateState(): void {
    this.state$.next({
      conflicts: Array.from(this.conflicts.values()),
      selectedConflictId: null,
      resolutionHistory: [...this.resolutionHistory],
      autoResolutionRules: [...this.autoResolutionRules],
    });
  }

  /**
   * Emit event
   */
  private emitEvent(type: ConflictEvent['type'], data?: unknown): void {
    this.events$.next({
      type,
      timestamp: Date.now(),
      data,
    });
  }

  /** Release resources held by this manager */
  destroy(): void {
    this.state$.complete();
    this.events$.complete();
  }
}

/**
 * Create a conflict manager
 */
export function createConflictManager(config?: ConflictResolutionConfig): ConflictManager {
  return new ConflictManager(config);
}
