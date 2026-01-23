import { Subject, type Observable } from 'rxjs';
import { LamportClock, VectorClockImpl, compareLamportTimestamps, generateOpId } from './clock.js';
import type {
  CollaborationEvent,
  JSONCRDTOperation,
  LamportTimestamp,
  MergeResult,
  NodeId,
  VectorClock,
} from './types.js';

/**
 * JSON path utilities
 */
function getValueAtPath(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function setValueAtPath(obj: unknown, path: string[], value: unknown): void {
  if (path.length === 0) return;

  let current = obj as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    current[key] ??= {};
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function deleteValueAtPath(obj: unknown, path: string[]): boolean {
  if (path.length === 0) return false;

  let current = obj as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (current[key] === undefined || current[key] === null) {
      return false;
    }
    current = current[key] as Record<string, unknown>;
  }

  const key = path[path.length - 1]!;
  if (key in current) {
    Reflect.deleteProperty(current, key);
    return true;
  }
  return false;
}

/**
 * Entry for tracking field versions
 */
interface FieldEntry {
  value: unknown;
  timestamp: LamportTimestamp;
  deleted: boolean;
}

/**
 * JSON CRDT Document for collaborative editing.
 *
 * Provides conflict-free replicated data type semantics for JSON documents,
 * enabling multiple users to edit the same document simultaneously without
 * conflicts. Changes are tracked at the field level using Lamport timestamps
 * for deterministic conflict resolution.
 *
 * @example Basic usage
 * ```typescript
 * // Create document on each node
 * const doc = createJSONCRDTDocument('doc-1', 'node-abc', {
 *   title: 'Untitled',
 *   content: '',
 * });
 *
 * // Make local changes
 * const op = doc.set(['title'], 'My Document');
 *
 * // Sync operation to other nodes
 * broadcastToOthers(op);
 *
 * // Apply remote operations
 * doc.applyRemote(remoteOp);
 * ```
 *
 * @example Conflict resolution
 * ```typescript
 * // Two nodes editing same field concurrently
 * const op1 = node1Doc.set(['title'], 'Title A');
 * const op2 = node2Doc.set(['title'], 'Title B');
 *
 * // Both apply each other's operations
 * const result1 = node1Doc.applyRemote(op2);
 * const result2 = node2Doc.applyRemote(op1);
 *
 * // Both converge to same value (deterministic winner)
 * console.log(node1Doc.getValue()); // Same on both nodes
 * console.log(node2Doc.getValue()); // Same on both nodes
 * ```
 *
 * @example Real-time collaboration
 * ```typescript
 * // Subscribe to events
 * doc.events().subscribe((event) => {
 *   switch (event.type) {
 *     case 'operation:local':
 *       // Send to server/peers
 *       broadcast(event.operation);
 *       break;
 *     case 'operation:remote':
 *       // Update UI
 *       refreshView();
 *       break;
 *     case 'conflict:detected':
 *       console.log('Conflict resolved automatically');
 *       break;
 *   }
 * });
 * ```
 *
 * @see {@link createJSONCRDTDocument} for factory function
 */
export class JSONCRDTDocument {
  private readonly id: string;
  private readonly nodeId: NodeId;
  private readonly clock: LamportClock;
  private readonly vclock: VectorClockImpl;

  // Store per-field timestamps for conflict resolution
  private fieldTimestamps: Map<string, FieldEntry>;

  // Current document value
  private root: Record<string, unknown>;

  // Applied operations for history
  private appliedOps: Map<string, JSONCRDTOperation>;

  // Pending operations (not yet acknowledged)
  private pendingOps: JSONCRDTOperation[];

  // Event emitter
  private events$ = new Subject<CollaborationEvent>();

  constructor(id: string, nodeId: NodeId, initialValue?: Record<string, unknown>) {
    this.id = id;
    this.nodeId = nodeId;
    this.clock = new LamportClock(nodeId);
    this.vclock = new VectorClockImpl(nodeId);
    this.fieldTimestamps = new Map();
    this.root = initialValue ? JSON.parse(JSON.stringify(initialValue)) : {};
    this.appliedOps = new Map();
    this.pendingOps = [];

    // Initialize field timestamps for initial value
    if (initialValue) {
      this.initializeFieldTimestamps([], initialValue);
    }
  }

  /**
   * Initialize field timestamps recursively
   */
  private initializeFieldTimestamps(path: string[], obj: Record<string, unknown>): void {
    const timestamp = this.clock.now();
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = [...path, key];
      const pathKey = fieldPath.join('.');

      this.fieldTimestamps.set(pathKey, {
        value,
        timestamp,
        deleted: false,
      });

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        this.initializeFieldTimestamps(fieldPath, value as Record<string, unknown>);
      }
    }
  }

  /**
   * Get the document ID.
   *
   * @returns The document's unique identifier
   */
  getId(): string {
    return this.id;
  }

  /**
   * Get the current document value.
   *
   * Returns a deep copy to prevent accidental mutation.
   *
   * @returns The current document state
   *
   * @example
   * ```typescript
   * const value = doc.getValue();
   * console.log(value.title);
   * ```
   */
  getValue(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this.root));
  }

  /**
   * Get value at a specific path in the document.
   *
   * @param path - Array of keys forming the path
   * @returns The value at the path, or undefined if not found
   *
   * @example
   * ```typescript
   * const title = doc.getValueAt(['title']);
   * const city = doc.getValueAt(['address', 'city']);
   * ```
   */
  getValueAt(path: string[]): unknown {
    return getValueAtPath(this.root, path);
  }

  /**
   * Set a value at a path (local operation).
   *
   * Creates an operation that can be synced to other nodes.
   *
   * @param path - Array of keys forming the path
   * @param value - The value to set
   * @returns The operation to broadcast to other nodes
   *
   * @example
   * ```typescript
   * // Set a top-level field
   * const op1 = doc.set(['title'], 'New Title');
   *
   * // Set a nested field
   * const op2 = doc.set(['author', 'name'], 'Alice');
   *
   * // Sync to other nodes
   * broadcast([op1, op2]);
   * ```
   */
  set(path: string[], value: unknown): JSONCRDTOperation {
    const timestamp = this.clock.tick();
    this.vclock.increment();
    const opId = generateOpId(this.nodeId, timestamp.counter);
    const pathKey = path.join('.');

    const previousValue = getValueAtPath(this.root, path);

    const op: JSONCRDTOperation = {
      id: opId,
      type: 'update',
      timestamp,
      origin: this.nodeId,
      path,
      value,
      previousValue,
    };

    // Apply locally
    setValueAtPath(this.root, path, value);
    this.fieldTimestamps.set(pathKey, { value, timestamp, deleted: false });
    this.appliedOps.set(opId, op);
    this.pendingOps.push(op);

    // Emit event
    this.events$.next({
      type: 'operation:local',
      operation: op,
      timestamp: Date.now(),
    });

    return op;
  }

  /**
   * Delete a value at a path (local operation).
   *
   * @param path - Array of keys forming the path
   * @returns The operation to broadcast, or null if path doesn't exist
   *
   * @example
   * ```typescript
   * const op = doc.delete(['metadata', 'draft']);
   * if (op) {
   *   broadcast(op);
   * }
   * ```
   */
  delete(path: string[]): JSONCRDTOperation | null {
    const timestamp = this.clock.tick();
    this.vclock.increment();
    const opId = generateOpId(this.nodeId, timestamp.counter);
    const pathKey = path.join('.');

    const previousValue = getValueAtPath(this.root, path);
    if (previousValue === undefined) {
      return null;
    }

    const op: JSONCRDTOperation = {
      id: opId,
      type: 'delete',
      timestamp,
      origin: this.nodeId,
      path,
      previousValue,
    };

    // Apply locally
    deleteValueAtPath(this.root, path);
    this.fieldTimestamps.set(pathKey, { value: undefined, timestamp, deleted: true });
    this.appliedOps.set(opId, op);
    this.pendingOps.push(op);

    // Emit event
    this.events$.next({
      type: 'operation:local',
      operation: op,
      timestamp: Date.now(),
    });

    return op;
  }

  /**
   * Apply a remote operation received from another node.
   *
   * Handles conflict resolution using Lamport timestamps:
   * - Later timestamp wins
   * - Equal timestamps: lower node ID wins (deterministic)
   *
   * @param op - The remote operation to apply
   * @returns Merge result with conflict information
   *
   * @example
   * ```typescript
   * socket.on('operation', (op) => {
   *   const result = doc.applyRemote(op);
   *   if (result.hadConflict) {
   *     console.log('Conflict resolved:', result.conflictingValues);
   *   }
   *   updateUI(doc.getValue());
   * });
   * ```
   */
  applyRemote(op: JSONCRDTOperation): MergeResult {
    // Skip if already applied
    if (this.appliedOps.has(op.id)) {
      return { value: this.getValue(), hadConflict: false };
    }

    this.clock.receive(op.timestamp);
    const pathKey = op.path.join('.');
    const existing = this.fieldTimestamps.get(pathKey);

    let hadConflict = false;
    let conflictingValues: unknown[] | undefined;

    // Check for conflict
    if (existing) {
      const comparison = compareLamportTimestamps(op.timestamp, existing.timestamp);

      if (comparison < 0) {
        // Remote operation is older, don't apply
        return { value: this.getValue(), hadConflict: false };
      } else if (comparison === 0) {
        // Concurrent operation - use node ID as tiebreaker
        hadConflict = true;
        conflictingValues = [existing.value, op.value];

        // Node ID comparison for deterministic ordering
        if (op.origin < this.nodeId) {
          // Remote wins
        } else {
          // Local wins, don't apply
          return {
            value: this.getValue(),
            hadConflict: true,
            conflictingValues,
          };
        }
      }
    }

    // Apply the operation
    if (op.type === 'delete') {
      deleteValueAtPath(this.root, op.path);
      this.fieldTimestamps.set(pathKey, {
        value: undefined,
        timestamp: op.timestamp,
        deleted: true,
      });
    } else {
      setValueAtPath(this.root, op.path, op.value);
      this.fieldTimestamps.set(pathKey, {
        value: op.value,
        timestamp: op.timestamp,
        deleted: false,
      });
    }

    this.appliedOps.set(op.id, op);

    // Emit event
    this.events$.next({
      type: 'operation:remote',
      nodeId: op.origin,
      operation: op,
      timestamp: Date.now(),
    });

    if (hadConflict) {
      this.events$.next({
        type: 'conflict:detected',
        operation: op,
        timestamp: Date.now(),
      });
    }

    return {
      value: this.getValue(),
      hadConflict,
      conflictingValues,
    };
  }

  /**
   * Get operations that haven't been acknowledged yet.
   *
   * @returns Array of pending operations
   */
  getPendingOps(): JSONCRDTOperation[] {
    return [...this.pendingOps];
  }

  /**
   * Mark operations as acknowledged (synced to server/peers).
   *
   * @param opIds - IDs of operations to acknowledge
   */
  acknowledgeOps(opIds: string[]): void {
    const ackSet = new Set(opIds);
    this.pendingOps = this.pendingOps.filter((op) => !ackSet.has(op.id));
  }

  /**
   * Get vector clock
   */
  getVectorClock(): VectorClock {
    return this.vclock.getClock();
  }

  /**
   * Merge with another document's state.
   *
   * Used for initial sync or reconciliation after network partition.
   *
   * @param other - The other document's state
   * @returns Merge result with the final value and conflict info
   *
   * @example
   * ```typescript
   * // On reconnect, get server state
   * const serverState = await fetchDocumentState(docId);
   * const result = doc.merge(serverState);
   *
   * if (result.hadConflict) {
   *   showConflictNotification();
   * }
   * ```
   */
  merge(other: JSONCRDTDocumentState): MergeResult<Record<string, unknown>> {
    let hadConflict = false;
    const conflictingValues: unknown[] = [];

    // Apply all operations from the other state
    for (const op of other.operations) {
      const result = this.applyRemote(op);
      if (result.hadConflict) {
        hadConflict = true;
        if (result.conflictingValues) {
          conflictingValues.push(...result.conflictingValues);
        }
      }
    }

    // Merge vector clocks
    this.vclock.merge(other.vclock);

    return {
      value: this.getValue(),
      hadConflict,
      conflictingValues: hadConflict ? (conflictingValues as Record<string, unknown>[]) : undefined,
    };
  }

  /**
   * Get the complete document state for serialization.
   *
   * Used for persistence or full state sync.
   *
   * @returns Serializable state object
   *
   * @example
   * ```typescript
   * // Save to storage
   * const state = doc.getState();
   * await storage.save(docId, JSON.stringify(state));
   * ```
   */
  getState(): JSONCRDTDocumentState {
    return {
      id: this.id,
      value: this.getValue(),
      vclock: this.vclock.getClock(),
      operations: Array.from(this.appliedOps.values()),
      fieldTimestamps: Object.fromEntries(
        Array.from(this.fieldTimestamps.entries()).map(([k, v]) => [
          k,
          { value: v.value, timestamp: v.timestamp, deleted: v.deleted },
        ])
      ),
    };
  }

  /**
   * Load state from serialized data.
   *
   * @param state - Previously saved state
   *
   * @example
   * ```typescript
   * // Load from storage
   * const saved = await storage.load(docId);
   * if (saved) {
   *   doc.loadState(JSON.parse(saved));
   * }
   * ```
   */
  loadState(state: JSONCRDTDocumentState): void {
    this.root = state.value;

    // Rebuild field timestamps
    this.fieldTimestamps.clear();
    for (const [path, entry] of Object.entries(state.fieldTimestamps)) {
      this.fieldTimestamps.set(path, {
        value: entry.value,
        timestamp: entry.timestamp,
        deleted: entry.deleted,
      });
    }

    // Rebuild applied ops
    this.appliedOps.clear();
    for (const op of state.operations) {
      this.appliedOps.set(op.id, op);
    }

    // Update clocks
    let maxCounter = 0;
    for (const op of state.operations) {
      maxCounter = Math.max(maxCounter, op.timestamp.counter);
    }

    this.clock.receive({ counter: maxCounter, nodeId: this.nodeId });
    this.vclock.merge(state.vclock);
  }

  /**
   * Subscribe to collaboration events.
   *
   * @returns Observable of collaboration events
   *
   * @example
   * ```typescript
   * doc.events().subscribe((event) => {
   *   if (event.type === 'conflict:detected') {
   *     showConflictIndicator();
   *   }
   * });
   * ```
   */
  events(): Observable<CollaborationEvent> {
    return this.events$.asObservable();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.events$.complete();
  }
}

/**
 * Serializable state of a JSON CRDT Document.
 *
 * Used for persistence and full state synchronization.
 */
export interface JSONCRDTDocumentState {
  id: string;
  value: Record<string, unknown>;
  vclock: VectorClock;
  operations: JSONCRDTOperation[];
  fieldTimestamps: Record<
    string,
    { value: unknown; timestamp: LamportTimestamp; deleted: boolean }
  >;
}

/**
 * Create a JSON CRDT Document for collaborative editing.
 *
 * @param id - Unique document identifier
 * @param nodeId - This node's unique identifier
 * @param initialValue - Optional initial document content
 * @returns A new JSONCRDTDocument instance
 *
 * @example
 * ```typescript
 * const nodeId = crypto.randomUUID();
 * const doc = createJSONCRDTDocument('doc-123', nodeId, {
 *   title: 'Untitled',
 *   content: '',
 *   metadata: { created: Date.now() },
 * });
 * ```
 *
 * @see {@link JSONCRDTDocument}
 */
export function createJSONCRDTDocument(
  id: string,
  nodeId: NodeId,
  initialValue?: Record<string, unknown>
): JSONCRDTDocument {
  return new JSONCRDTDocument(id, nodeId, initialValue);
}
