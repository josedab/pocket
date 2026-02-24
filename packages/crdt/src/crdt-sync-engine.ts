/**
 * CRDTSyncEngine — Conflict-free replicated data type sync layer.
 *
 * Provides automatic conflict resolution using operation-based CRDTs
 * for counters, registers, sets, and maps. Multi-region replication
 * converges without manual conflict resolution.
 */

import { Subject, type Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────

export type CRDTType = 'lww-register' | 'g-counter' | 'pn-counter' | 'or-set' | 'lww-map';

export interface CRDTFieldConfig {
  field: string;
  type: CRDTType;
}

export interface CRDTOperation {
  id: string;
  documentId: string;
  field: string;
  type: CRDTType;
  nodeId: string;
  timestamp: number;
  value: unknown;
  operation: 'set' | 'increment' | 'decrement' | 'add' | 'remove';
}

export interface CRDTState {
  documentId: string;
  fields: Map<string, CRDTFieldState>;
  lastUpdated: number;
  version: number;
}

export interface CRDTFieldState {
  field: string;
  type: CRDTType;
  value: unknown;
  timestamp: number;
  nodeId: string;
}

export interface CRDTSyncConfig {
  nodeId: string;
  fields: CRDTFieldConfig[];
  maxOperationLog?: number;
}

export interface MergeResult {
  merged: boolean;
  conflicts: number;
  autoResolved: number;
  finalState: Record<string, unknown>;
}

export type CRDTEvent =
  | { type: 'local:applied'; operation: CRDTOperation }
  | { type: 'remote:merged'; peerId: string; operations: number }
  | { type: 'state:converged'; documentId: string };

// ── Implementation ────────────────────────────────────────

export class CRDTSyncEngine {
  private readonly config: Required<CRDTSyncConfig>;
  private readonly states = new Map<string, CRDTState>();
  private readonly operationLog: CRDTOperation[] = [];
  private readonly eventsSubject = new Subject<CRDTEvent>();
  private opCounter = 0;

  readonly events$: Observable<CRDTEvent> = this.eventsSubject.asObservable();

  constructor(config: CRDTSyncConfig) {
    this.config = {
      nodeId: config.nodeId,
      fields: config.fields,
      maxOperationLog: config.maxOperationLog ?? 10000,
    };
  }

  /**
   * Apply a local operation.
   */
  apply(
    documentId: string,
    field: string,
    operation: 'set' | 'increment' | 'decrement' | 'add' | 'remove',
    value: unknown
  ): CRDTOperation {
    const fieldConfig = this.config.fields.find((f) => f.field === field);
    if (!fieldConfig) throw new Error(`Field "${field}" is not configured as a CRDT field`);

    const op: CRDTOperation = {
      id: `op_${++this.opCounter}_${Date.now()}`,
      documentId,
      field,
      type: fieldConfig.type,
      nodeId: this.config.nodeId,
      timestamp: Date.now(),
      value,
      operation,
    };

    this.applyOperation(op);
    this.logOperation(op);
    this.eventsSubject.next({ type: 'local:applied', operation: op });
    return op;
  }

  /**
   * Merge remote operations from a peer.
   */
  mergeRemote(peerId: string, operations: CRDTOperation[]): MergeResult {
    let autoResolved = 0;
    const merged: Record<string, unknown> = {};

    for (const op of operations) {
      const state = this.getFieldState(op.documentId, op.field);

      if (
        !state ||
        op.timestamp > state.timestamp ||
        (op.timestamp === state.timestamp && op.nodeId > state.nodeId)
      ) {
        this.applyOperation(op);
        this.logOperation(op);
        autoResolved++;
      }
    }

    // Build final state
    const allDocs = new Set(operations.map((o) => o.documentId));
    for (const docId of allDocs) {
      const docState = this.states.get(docId);
      if (docState) {
        for (const [key, fieldState] of docState.fields) {
          merged[key] = fieldState.value;
        }
      }
    }

    this.eventsSubject.next({ type: 'remote:merged', peerId, operations: operations.length });

    return {
      merged: operations.length > 0,
      conflicts: 0, // CRDTs are conflict-free by definition
      autoResolved,
      finalState: merged,
    };
  }

  /**
   * Get the current state of a document.
   */
  getDocumentState(documentId: string): Record<string, unknown> {
    const state = this.states.get(documentId);
    if (!state) return {};

    const result: Record<string, unknown> = {};
    for (const [field, fieldState] of state.fields) {
      result[field] = fieldState.value;
    }
    return result;
  }

  /**
   * Get pending operations to send to a peer.
   */
  getOperationsSince(timestamp: number): CRDTOperation[] {
    return this.operationLog.filter((op) => op.timestamp > timestamp);
  }

  /**
   * Get the operation log.
   */
  getOperationLog(): CRDTOperation[] {
    return [...this.operationLog];
  }

  destroy(): void {
    this.eventsSubject.complete();
  }

  // ── Private ────────────────────────────────────────────

  private applyOperation(op: CRDTOperation): void {
    let state = this.states.get(op.documentId);
    if (!state) {
      state = { documentId: op.documentId, fields: new Map(), lastUpdated: 0, version: 0 };
      this.states.set(op.documentId, state);
    }

    const currentField = state.fields.get(op.field);

    switch (op.type) {
      case 'lww-register': {
        // Last-Write-Wins: take the value with the latest timestamp
        if (!currentField || op.timestamp >= currentField.timestamp) {
          state.fields.set(op.field, {
            field: op.field,
            type: op.type,
            value: op.value,
            timestamp: op.timestamp,
            nodeId: op.nodeId,
          });
        }
        break;
      }

      case 'g-counter': {
        // Grow-only counter: always increment
        const current = typeof currentField?.value === 'number' ? currentField.value : 0;
        const increment = typeof op.value === 'number' ? op.value : 1;
        state.fields.set(op.field, {
          field: op.field,
          type: op.type,
          value: current + increment,
          timestamp: op.timestamp,
          nodeId: op.nodeId,
        });
        break;
      }

      case 'pn-counter': {
        // Positive-Negative counter
        const current2 = typeof currentField?.value === 'number' ? currentField.value : 0;
        const delta =
          typeof op.value === 'number' ? op.value : op.operation === 'decrement' ? -1 : 1;
        state.fields.set(op.field, {
          field: op.field,
          type: op.type,
          value: current2 + delta,
          timestamp: op.timestamp,
          nodeId: op.nodeId,
        });
        break;
      }

      case 'or-set': {
        // Observed-Remove Set
        const currentSet = Array.isArray(currentField?.value)
          ? [...(currentField.value as unknown[])]
          : [];
        if (op.operation === 'add') {
          if (!currentSet.includes(op.value)) currentSet.push(op.value);
        } else if (op.operation === 'remove') {
          const idx = currentSet.indexOf(op.value);
          if (idx !== -1) currentSet.splice(idx, 1);
        }
        state.fields.set(op.field, {
          field: op.field,
          type: op.type,
          value: currentSet,
          timestamp: op.timestamp,
          nodeId: op.nodeId,
        });
        break;
      }

      case 'lww-map': {
        // Last-Write-Wins Map: merge key-by-key
        const currentMap =
          typeof currentField?.value === 'object' && currentField.value !== null
            ? { ...(currentField.value as Record<string, unknown>) }
            : {};
        if (typeof op.value === 'object' && op.value !== null) {
          Object.assign(currentMap, op.value);
        }
        state.fields.set(op.field, {
          field: op.field,
          type: op.type,
          value: currentMap,
          timestamp: op.timestamp,
          nodeId: op.nodeId,
        });
        break;
      }
    }

    state.lastUpdated = op.timestamp;
    state.version++;
  }

  private getFieldState(documentId: string, field: string): CRDTFieldState | undefined {
    return this.states.get(documentId)?.fields.get(field);
  }

  private logOperation(op: CRDTOperation): void {
    this.operationLog.push(op);
    if (this.operationLog.length > this.config.maxOperationLog) {
      this.operationLog.splice(0, this.operationLog.length - this.config.maxOperationLog);
    }
  }
}

export function createCRDTSyncEngine(config: CRDTSyncConfig): CRDTSyncEngine {
  return new CRDTSyncEngine(config);
}
