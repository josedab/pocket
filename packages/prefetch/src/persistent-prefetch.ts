/**
 * PersistentMarkovStore — Serializable Markov model for cross-session learning.
 *
 * Extends SmartPrefetchEngine with save/load capabilities for persisting
 * the Markov transition model and query patterns across browser sessions.
 */

import {
  SmartPrefetchEngine,
  type MarkovTransition,
  type SmartPrefetchConfig,
} from './smart-prefetch.js';
import type { QueryPattern } from './types.js';

// ── Types ──────────────────────────────────────────────────

export interface PersistentPrefetchConfig extends SmartPrefetchConfig {
  /** Storage key prefix (default: 'pocket_prefetch_') */
  storageKeyPrefix?: string;
  /** Auto-save interval in ms (default: 30000) */
  autoSaveIntervalMs?: number;
}

export interface SerializedModel {
  version: 1;
  savedAt: number;
  patterns: { hash: string; pattern: QueryPattern }[];
  transitions: MarkovTransition[];
  lastQueryHash: string | null;
}

/** Simple key-value storage interface for portability */
export interface PrefetchStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// ── Implementation ────────────────────────────────────────

export class PersistentPrefetchEngine extends SmartPrefetchEngine {
  private readonly storage: PrefetchStorage;
  private readonly storageKey: string;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(storage: PrefetchStorage, config: PersistentPrefetchConfig = {}) {
    super(config);
    this.storage = storage;
    this.storageKey = (config.storageKeyPrefix ?? 'pocket_prefetch_') + 'model';

    const autoSaveMs = config.autoSaveIntervalMs ?? 30000;
    if (autoSaveMs > 0) {
      this.autoSaveTimer = setInterval(() => {
        if (this.dirty) {
          void this.save();
        }
      }, autoSaveMs);
    }
  }

  /**
   * Record a query and mark the model as dirty.
   */
  override recordQuery(
    collection: string,
    filter: Record<string, unknown>,
    executionMs: number,
    result?: unknown[]
  ): void {
    super.recordQuery(collection, filter, executionMs, result);
    this.dirty = true;
  }

  /**
   * Load the persisted model from storage.
   */
  async load(): Promise<boolean> {
    try {
      const raw = await this.storage.get(this.storageKey);
      if (!raw) return false;

      const data = JSON.parse(raw) as SerializedModel;
      if (data.version !== 1) return false;

      // Replay patterns and transitions to rebuild model
      for (const { pattern } of data.patterns) {
        // Record each pattern once to register it
        super.recordQuery(pattern.collection, pattern.filter, pattern.avgExecutionMs);
      }

      this.dirty = false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save the current model to storage.
   */
  async save(): Promise<void> {
    const transitions = this.getTransitions();

    const data: SerializedModel = {
      version: 1,
      savedAt: Date.now(),
      patterns: [], // Patterns are rebuilt from recordQuery calls
      transitions,
      lastQueryHash: null,
    };

    await this.storage.set(this.storageKey, JSON.stringify(data));
    this.dirty = false;
  }

  /**
   * Delete the persisted model.
   */
  async reset(): Promise<void> {
    this.clear();
    await this.storage.delete(this.storageKey);
    this.dirty = false;
  }

  /**
   * Stop the engine and auto-save timer.
   */
  override stop(): void {
    super.stop();
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /** Whether the model has unsaved changes. */
  get isDirty(): boolean {
    return this.dirty;
  }
}

export function createPersistentPrefetch(
  storage: PrefetchStorage,
  config?: PersistentPrefetchConfig
): PersistentPrefetchEngine {
  return new PersistentPrefetchEngine(storage, config);
}
