/**
 * Offline Form Manager - CRDT-backed form state management
 *
 * Bridges @pocket/forms with @pocket/crdt for conflict-free offline editing.
 */
import { BehaviorSubject, type Observable } from 'rxjs';
import type { MergeResult, NodeId, VectorClock } from './offline-form-types.js';

import type {
  ConflictResolutionStrategy,
  CRDTFieldConfig,
  FieldConflict,
  OfflineFormConfig,
  OfflineFormSnapshot,
  OfflineFormState,
} from './offline-form-types.js';

/** Internal representation of a field's CRDT state */
interface CRDTFieldState {
  type: 'lww' | 'text' | 'counter';
  value: unknown;
  timestamp: number;
  nodeId: NodeId;
  vectorClock: VectorClock;
  // For counter fields
  positive?: Record<NodeId, number>;
  negative?: Record<NodeId, number>;
  // For conflict tracking
  conflictingValues?: unknown[];
}

/**
 * Manages form state backed by CRDT primitives for offline-first editing.
 */
export class OfflineFormManager {
  private readonly formId: string;
  private readonly nodeId: NodeId;
  private readonly fieldTypes: Record<string, CRDTFieldConfig>;
  private readonly fields = new Map<string, CRDTFieldState>();
  private readonly state$: BehaviorSubject<OfflineFormState>;
  private localClock = 0;
  private vectorClock: VectorClock = {};
  private pendingChanges = 0;

  constructor(config: OfflineFormConfig, initialValues?: Record<string, unknown>) {
    this.formId = config.formId;
    this.nodeId = config.nodeId;
    this.fieldTypes = config.fieldTypes ?? {};
    this.vectorClock = { [this.nodeId]: 0 };

    // Initialize fields from initial values
    if (initialValues) {
      for (const [name, value] of Object.entries(initialValues)) {
        const fieldType = this.fieldTypes[name]?.type ?? 'lww';
        this.fields.set(name, {
          type: fieldType,
          value,
          timestamp: 0,
          nodeId: this.nodeId,
          vectorClock: { [this.nodeId]: 0 },
          ...(fieldType === 'counter'
            ? {
                positive: { [this.nodeId]: typeof value === 'number' ? value : 0 },
                negative: {},
              }
            : {}),
        });
      }
    }

    this.state$ = new BehaviorSubject<OfflineFormState>(this.computeState());
  }

  /** Get current state as observable */
  get state(): Observable<OfflineFormState> {
    return this.state$.asObservable();
  }

  /** Get current state snapshot */
  getState(): OfflineFormState {
    return this.state$.value;
  }

  /** Get current values */
  getValues(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [name, field] of this.fields) {
      if (field.type === 'counter') {
        const pos = Object.values(field.positive ?? {}).reduce((s, n) => s + n, 0);
        const neg = Object.values(field.negative ?? {}).reduce((s, n) => s + n, 0);
        values[name] = pos - neg;
      } else {
        values[name] = field.value;
      }
    }
    return values;
  }

  /** Set a field value (LWW or text) */
  setValue(name: string, value: unknown): void {
    this.localClock++;
    this.vectorClock[this.nodeId] = this.localClock;

    const fieldType = this.fieldTypes[name]?.type ?? 'lww';
    const existing = this.fields.get(name);

    this.fields.set(name, {
      type: fieldType,
      value,
      timestamp: this.localClock,
      nodeId: this.nodeId,
      vectorClock: { ...this.vectorClock },
      positive: existing?.positive,
      negative: existing?.negative,
      conflictingValues: undefined, // Clear conflicts on local write
    });

    this.pendingChanges++;
    this.emitState();
  }

  /** Set multiple values at once */
  setValues(values: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(values)) {
      this.setValue(name, value);
    }
  }

  /** Increment a counter field */
  increment(name: string, amount = 1): void {
    if (amount < 0) {
      this.decrement(name, -amount);
      return;
    }

    this.localClock++;
    this.vectorClock[this.nodeId] = this.localClock;

    const existing = this.fields.get(name);
    const positive = { ...(existing?.positive ?? {}) };
    positive[this.nodeId] = (positive[this.nodeId] ?? 0) + amount;

    this.fields.set(name, {
      type: 'counter',
      value: null,
      timestamp: this.localClock,
      nodeId: this.nodeId,
      vectorClock: { ...this.vectorClock },
      positive,
      negative: { ...(existing?.negative ?? {}) },
    });

    this.pendingChanges++;
    this.emitState();
  }

  /** Decrement a counter field */
  decrement(name: string, amount = 1): void {
    if (amount < 0) {
      this.increment(name, -amount);
      return;
    }

    this.localClock++;
    this.vectorClock[this.nodeId] = this.localClock;

    const existing = this.fields.get(name);
    const negative = { ...(existing?.negative ?? {}) };
    negative[this.nodeId] = (negative[this.nodeId] ?? 0) + amount;

    this.fields.set(name, {
      type: 'counter',
      value: null,
      timestamp: this.localClock,
      nodeId: this.nodeId,
      vectorClock: { ...this.vectorClock },
      positive: { ...(existing?.positive ?? {}) },
      negative,
    });

    this.pendingChanges++;
    this.emitState();
  }

  /** Apply remote snapshot from another node */
  applyRemote(snapshot: OfflineFormSnapshot): MergeResult<Record<string, unknown>> {
    const conflicts: FieldConflict[] = [];
    let hadConflict = false;

    for (const [name, remoteValue] of Object.entries(snapshot.values)) {
      const local = this.fields.get(name);
      const fieldType = this.fieldTypes[name]?.type ?? 'lww';

      if (!local) {
        // New field from remote - accept directly
        this.fields.set(name, {
          type: fieldType,
          value: remoteValue,
          timestamp: snapshot.timestamp,
          nodeId: snapshot.nodeId,
          vectorClock: { ...snapshot.vectorClock },
        });
        continue;
      }

      if (fieldType === 'counter') {
        // Counters merge without conflict
        const remoteState = snapshot.fieldStates[name] as
          | { positive?: Record<string, number>; negative?: Record<string, number> }
          | undefined;
        if (remoteState) {
          const mergedPositive = { ...(local.positive ?? {}) };
          for (const [nid, val] of Object.entries(remoteState.positive ?? {})) {
            mergedPositive[nid] = Math.max(mergedPositive[nid] ?? 0, val);
          }
          const mergedNegative = { ...(local.negative ?? {}) };
          for (const [nid, val] of Object.entries(remoteState.negative ?? {})) {
            mergedNegative[nid] = Math.max(mergedNegative[nid] ?? 0, val);
          }
          local.positive = mergedPositive;
          local.negative = mergedNegative;
        }
        continue;
      }

      // LWW/text: check for concurrent edits
      const remoteTs = snapshot.vectorClock[snapshot.nodeId] ?? 0;
      const localTs = local.vectorClock[local.nodeId] ?? 0;
      const isConcurrent =
        !this.happenedBefore(local.vectorClock, snapshot.vectorClock) &&
        !this.happenedBefore(snapshot.vectorClock, local.vectorClock);

      if (isConcurrent && local.value !== remoteValue) {
        // Concurrent edit detected - conflict
        hadConflict = true;
        conflicts.push({
          fieldName: name,
          localValue: local.value,
          remoteValues: [remoteValue],
          timestamp: Date.now(),
        });
        local.conflictingValues = [local.value, remoteValue];

        // LWW resolution: higher timestamp wins, nodeId as tiebreaker
        if (remoteTs > localTs || (remoteTs === localTs && snapshot.nodeId > local.nodeId)) {
          local.value = remoteValue;
        }
      } else if (this.happenedBefore(local.vectorClock, snapshot.vectorClock)) {
        // Remote is newer, accept
        local.value = remoteValue;
        local.timestamp = snapshot.timestamp;
        local.nodeId = snapshot.nodeId;
      }
    }

    // Merge vector clocks
    this.mergeVectorClocks(snapshot.vectorClock);
    this.pendingChanges = 0;
    this.emitState();

    return {
      value: this.getValues(),
      hadConflict,
      conflictingValues: hadConflict
        ? conflicts.map(
            (c) => ({ field: c.fieldName, value: c.localValue }) as Record<string, unknown>
          )
        : undefined,
    };
  }

  /** Get snapshot for syncing */
  getSnapshot(): OfflineFormSnapshot {
    const values: Record<string, unknown> = {};
    const fieldStates: Record<string, unknown> = {};

    for (const [name, field] of this.fields) {
      if (field.type === 'counter') {
        const pos = Object.values(field.positive ?? {}).reduce((s, n) => s + n, 0);
        const neg = Object.values(field.negative ?? {}).reduce((s, n) => s + n, 0);
        values[name] = pos - neg;
        fieldStates[name] = { positive: field.positive, negative: field.negative };
      } else {
        values[name] = field.value;
        fieldStates[name] = { value: field.value, timestamp: field.timestamp };
      }
    }

    return {
      formId: this.formId,
      nodeId: this.nodeId,
      values,
      fieldStates,
      vectorClock: { ...this.vectorClock },
      timestamp: Date.now(),
    };
  }

  /** Resolve a specific field conflict */
  resolveConflict(fieldName: string, value: unknown): void {
    const field = this.fields.get(fieldName);
    if (!field) return;

    this.localClock++;
    this.vectorClock[this.nodeId] = this.localClock;

    field.value = value;
    field.conflictingValues = undefined;
    field.timestamp = this.localClock;
    field.nodeId = this.nodeId;
    field.vectorClock = { ...this.vectorClock };

    this.emitState();
  }

  /** Resolve all conflicts with a strategy */
  resolveAllConflicts(strategy: ConflictResolutionStrategy): void {
    for (const [name, field] of this.fields) {
      if (!field.conflictingValues || field.conflictingValues.length === 0) continue;

      let resolved: unknown;
      switch (strategy) {
        case 'local':
          resolved = field.conflictingValues[0];
          break;
        case 'remote':
          resolved = field.conflictingValues[field.conflictingValues.length - 1];
          break;
        case 'merge':
          // For strings, concatenate; otherwise use local
          if (typeof field.conflictingValues[0] === 'string') {
            resolved = field.conflictingValues.join(' ');
          } else {
            resolved = field.conflictingValues[0];
          }
          break;
        case 'manual':
          // Skip - manual resolution required per-field
          continue;
      }

      this.resolveConflict(name, resolved);
    }
  }

  /** Reset to clean state */
  reset(): void {
    this.fields.clear();
    this.localClock = 0;
    this.vectorClock = { [this.nodeId]: 0 };
    this.pendingChanges = 0;
    this.emitState();
  }

  /** Clean up resources */
  destroy(): void {
    this.state$.complete();
  }

  // --- Private helpers ---

  private computeState(): OfflineFormState {
    const conflicts: FieldConflict[] = [];
    for (const [name, field] of this.fields) {
      if (field.conflictingValues && field.conflictingValues.length > 1) {
        conflicts.push({
          fieldName: name,
          localValue: field.conflictingValues[0],
          remoteValues: field.conflictingValues.slice(1),
          timestamp: Date.now(),
        });
      }
    }

    return {
      values: this.getValues(),
      hasConflicts: conflicts.length > 0,
      conflicts,
      isSyncing: false,
      pendingChanges: this.pendingChanges,
      vectorClock: { ...this.vectorClock },
      lastSyncedAt: null,
    };
  }

  private emitState(): void {
    this.state$.next(this.computeState());
  }

  private happenedBefore(a: VectorClock, b: VectorClock): boolean {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let strictlyLess = false;
    for (const key of allKeys) {
      const aVal = a[key] ?? 0;
      const bVal = b[key] ?? 0;
      if (aVal > bVal) return false;
      if (aVal < bVal) strictlyLess = true;
    }
    return strictlyLess;
  }

  private mergeVectorClocks(remote: VectorClock): void {
    for (const [nodeId, counter] of Object.entries(remote)) {
      this.vectorClock[nodeId] = Math.max(this.vectorClock[nodeId] ?? 0, counter);
    }
  }
}

/** Create an offline form manager */
export function createOfflineFormManager(
  config: OfflineFormConfig,
  initialValues?: Record<string, unknown>
): OfflineFormManager {
  return new OfflineFormManager(config, initialValues);
}
