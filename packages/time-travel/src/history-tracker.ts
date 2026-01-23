/**
 * History Tracker - Records document changes over time
 */

import type { Document } from '@pocket/core';
import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import type {
  ChangeOperation,
  DocumentDiff,
  HistoryEntry,
  HistoryFilterOptions,
  OperationType,
  Snapshot,
  TimeTravelConfig,
  TimeTravelEvent,
  TimeTravelState,
} from './types.js';
import { DEFAULT_TIME_TRAVEL_CONFIG } from './types.js';

/**
 * Generates a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Tracks and manages document history for time travel debugging
 */
export class HistoryTracker {
  private readonly config: Required<TimeTravelConfig>;
  private readonly history: HistoryEntry[] = [];
  private readonly snapshots: Snapshot[] = [];

  private readonly state$ = new BehaviorSubject<TimeTravelState>({
    currentIndex: 0,
    totalEntries: 0,
    isTimeTraveling: false,
    currentSnapshot: null,
    checkpoints: [],
  });

  private readonly events$ = new Subject<TimeTravelEvent>();
  private operationsSinceCheckpoint = 0;
  private currentTransactionId: string | null = null;
  private pendingOperations: ChangeOperation[] = [];

  constructor(config: TimeTravelConfig = {}) {
    this.config = { ...DEFAULT_TIME_TRAVEL_CONFIG, ...config };
  }

  /**
   * Record a document change
   */
  recordChange<T extends Document>(
    type: OperationType,
    collection: string,
    documentId: string,
    before: T | null,
    after: T | null,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.config.enabled) return;

    const operation: ChangeOperation<T> = {
      type,
      collection,
      documentId,
      before,
      after,
      timestamp: Date.now(),
      metadata,
    };

    // If in a transaction, batch the operations
    if (this.currentTransactionId) {
      this.pendingOperations.push(operation);
      return;
    }

    // Record single operation
    this.addHistoryEntry([operation]);
  }

  /**
   * Start a transaction to batch multiple operations
   */
  startTransaction(_label?: string): string {
    if (this.currentTransactionId) {
      throw new Error('Transaction already in progress');
    }

    this.currentTransactionId = generateId();
    this.pendingOperations = [];

    return this.currentTransactionId;
  }

  /**
   * Commit the current transaction
   */
  commitTransaction(label?: string): void {
    if (!this.currentTransactionId) {
      throw new Error('No transaction in progress');
    }

    if (this.pendingOperations.length > 0) {
      this.addHistoryEntry(this.pendingOperations, label, this.currentTransactionId);
    }

    this.currentTransactionId = null;
    this.pendingOperations = [];
  }

  /**
   * Rollback the current transaction
   */
  rollbackTransaction(): ChangeOperation[] {
    if (!this.currentTransactionId) {
      throw new Error('No transaction in progress');
    }

    const operations = [...this.pendingOperations];
    this.currentTransactionId = null;
    this.pendingOperations = [];

    return operations;
  }

  /**
   * Add a history entry
   */
  private addHistoryEntry(
    operations: ChangeOperation[],
    label?: string,
    transactionId?: string
  ): void {
    const entry: HistoryEntry = {
      id: generateId(),
      operations,
      timestamp: Date.now(),
      label,
      isCheckpoint: false,
      transactionId,
    };

    this.history.push(entry);
    this.operationsSinceCheckpoint += operations.length;

    // Enforce max history size
    while (this.history.length > this.config.maxHistorySize) {
      this.history.shift();
    }

    // Auto checkpoint if needed
    if (
      this.config.autoCheckpoint &&
      this.operationsSinceCheckpoint >= this.config.checkpointInterval
    ) {
      this.createCheckpoint(`Auto checkpoint at ${new Date().toISOString()}`);
    }

    this.updateState();
    this.emitEvent('operation_recorded', { entry });
  }

  /**
   * Create a checkpoint snapshot
   */
  createCheckpoint(label?: string): Snapshot {
    const snapshot = this.captureCurrentSnapshot(label);
    snapshot.index = this.history.length;

    // Mark the corresponding history entry as a checkpoint
    if (this.history.length > 0) {
      this.history[this.history.length - 1]!.isCheckpoint = true;
    }

    this.snapshots.push(snapshot);
    this.operationsSinceCheckpoint = 0;

    this.updateState();
    this.emitEvent('checkpoint_created', { snapshot });

    return snapshot;
  }

  /**
   * Capture current state as a snapshot
   */
  private captureCurrentSnapshot(label?: string): Snapshot {
    const collections: Record<string, Record<string, Document>> = {};

    // Replay all operations from the beginning to get current state
    for (const entry of this.history) {
      for (const op of entry.operations) {
        collections[op.collection] ??= {};

        if (op.type === 'delete') {
          Reflect.deleteProperty(collections[op.collection]!, op.documentId);
        } else if (op.after) {
          collections[op.collection]![op.documentId] = op.after;
        }
      }
    }

    return {
      id: generateId(),
      label,
      timestamp: Date.now(),
      collections,
      index: this.history.length,
    };
  }

  /**
   * Get snapshot at a specific history index
   */
  getSnapshotAtIndex(targetIndex: number): Snapshot {
    // Find the nearest checkpoint before the target index
    let baseSnapshot: Snapshot | null = null;
    let startIndex = 0;

    for (const snapshot of this.snapshots) {
      if (snapshot.index <= targetIndex) {
        baseSnapshot = snapshot;
        startIndex = snapshot.index;
      } else {
        break;
      }
    }

    // Start from checkpoint or empty state
    const collections: Record<string, Record<string, Document>> = baseSnapshot
      ? JSON.parse(JSON.stringify(baseSnapshot.collections))
      : {};

    // Apply operations from startIndex to targetIndex
    for (let i = startIndex; i < targetIndex && i < this.history.length; i++) {
      const entry = this.history[i]!;
      for (const op of entry.operations) {
        collections[op.collection] ??= {};

        if (op.type === 'delete') {
          Reflect.deleteProperty(collections[op.collection]!, op.documentId);
        } else if (op.after) {
          collections[op.collection]![op.documentId] = op.after;
        }
      }
    }

    return {
      id: generateId(),
      timestamp: Date.now(),
      collections,
      index: targetIndex,
    };
  }

  /**
   * Get history entries with optional filtering
   */
  getHistory(options: HistoryFilterOptions = {}): HistoryEntry[] {
    let entries = [...this.history];

    if (options.collection) {
      entries = entries.filter((e) =>
        e.operations.some((op) => op.collection === options.collection)
      );
    }

    if (options.documentId) {
      entries = entries.filter((e) =>
        e.operations.some((op) => op.documentId === options.documentId)
      );
    }

    if (options.operationType) {
      entries = entries.filter((e) => e.operations.some((op) => op.type === options.operationType));
    }

    if (options.startTime) {
      entries = entries.filter((e) => e.timestamp >= options.startTime!);
    }

    if (options.endTime) {
      entries = entries.filter((e) => e.timestamp <= options.endTime!);
    }

    if (options.label) {
      entries = entries.filter((e) =>
        e.label?.toLowerCase().includes(options.label!.toLowerCase())
      );
    }

    if (options.offset) {
      entries = entries.slice(options.offset);
    }

    if (options.limit) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  /**
   * Get document history
   */
  getDocumentHistory(collection: string, documentId: string): ChangeOperation[] {
    const operations: ChangeOperation[] = [];

    for (const entry of this.history) {
      for (const op of entry.operations) {
        if (op.collection === collection && op.documentId === documentId) {
          operations.push(op);
        }
      }
    }

    return operations;
  }

  /**
   * Compute diff between two document states
   */
  computeDiff<T extends Document>(
    collection: string,
    documentId: string,
    before: T | null,
    after: T | null
  ): DocumentDiff<T> {
    const diff: DocumentDiff<T> = {
      documentId,
      collection,
      added: {},
      removed: {},
      changed: {},
    };

    if (!before && after) {
      // Document created - all fields are "added"
      diff.added = { ...after };
    } else if (before && !after) {
      // Document deleted - all fields are "removed"
      diff.removed = { ...before };
    } else if (before && after) {
      // Document updated - compare fields
      const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

      for (const key of allKeys) {
        const k = key as keyof T;
        const beforeVal = before[k];
        const afterVal = after[k];

        if (beforeVal === undefined && afterVal !== undefined) {
          (diff.added as Record<string, unknown>)[key] = afterVal;
        } else if (beforeVal !== undefined && afterVal === undefined) {
          (diff.removed as Record<string, unknown>)[key] = beforeVal;
        } else if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
          (diff.changed as Record<string, unknown>)[key] = {
            before: beforeVal,
            after: afterVal,
          };
        }
      }
    }

    return diff;
  }

  /**
   * Clear all history
   */
  clearHistory(): void {
    this.history.length = 0;
    this.snapshots.length = 0;
    this.operationsSinceCheckpoint = 0;

    this.updateState();
    this.emitEvent('history_cleared');
  }

  /**
   * Get checkpoints
   */
  getCheckpoints(): Snapshot[] {
    return [...this.snapshots];
  }

  /**
   * Get state observable
   */
  get state(): Observable<TimeTravelState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state
   */
  getCurrentState(): TimeTravelState {
    return this.state$.value;
  }

  /**
   * Get events observable
   */
  get events(): Observable<TimeTravelEvent> {
    return this.events$.asObservable();
  }

  /**
   * Update state
   */
  private updateState(): void {
    const currentState = this.state$.value;
    this.state$.next({
      ...currentState,
      totalEntries: this.history.length,
      checkpoints: [...this.snapshots],
    });
  }

  /**
   * Emit event
   */
  private emitEvent(type: TimeTravelEvent['type'], data?: unknown): void {
    this.events$.next({
      type,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Export history
   */
  exportHistory(): {
    entries: HistoryEntry[];
    snapshots: Snapshot[];
    config: TimeTravelConfig;
  } {
    return {
      entries: [...this.history],
      snapshots: [...this.snapshots],
      config: this.config,
    };
  }

  /**
   * Import history
   */
  importHistory(data: { entries: HistoryEntry[]; snapshots?: Snapshot[] }): void {
    this.clearHistory();

    for (const entry of data.entries) {
      this.history.push(entry);
    }

    if (data.snapshots) {
      for (const snapshot of data.snapshots) {
        this.snapshots.push(snapshot);
      }
    }

    this.updateState();
  }

  /**
   * Get total history size in bytes (approximate)
   */
  getHistorySize(): number {
    return JSON.stringify(this.history).length;
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable/disable tracking
   */
  setEnabled(enabled: boolean): void {
    (this.config as { enabled: boolean }).enabled = enabled;
  }
}

/**
 * Create a history tracker
 */
export function createHistoryTracker(config?: TimeTravelConfig): HistoryTracker {
  return new HistoryTracker(config);
}
