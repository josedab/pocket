/**
 * Represents sync progress state for resumable synchronization.
 *
 * Checkpoints track the last synced sequence number for each collection,
 * allowing sync to resume from where it left off after disconnection.
 *
 * ## Sequence Numbers
 *
 * Each change in a collection has an incrementing sequence number.
 * The checkpoint stores the highest synced sequence per collection:
 *
 * ```
 * {
 *   sequences: {
 *     "todos": 42,      // Synced up to change #42
 *     "users": 15,      // Synced up to change #15
 *   }
 * }
 * ```
 *
 * When pulling changes, the client sends its checkpoint. The server
 * returns only changes with sequence > checkpoint.sequences[collection].
 */
export interface Checkpoint {
  /** Unique identifier for this checkpoint (format: `{nodeId}_{timestamp}`) */
  id: string;
  /** Map of collection names to their last synced sequence numbers */
  sequences: Record<string, number>;
  /** Unix timestamp of when checkpoint was last updated */
  timestamp: number;
  /** Unique identifier for the client node */
  nodeId: string;
}

/**
 * Manages sync checkpoints for tracking and resuming synchronization.
 *
 * The CheckpointManager persists sync progress to localStorage, enabling
 * efficient resumption after app restarts or reconnections. Each client
 * maintains its own checkpoint, identified by a unique node ID.
 *
 * ## How It Works
 *
 * ```
 * Client                              Server
 *   │                                    │
 *   │ ── pull(checkpoint) ─────────────► │
 *   │                                    │ (finds changes after checkpoint)
 *   │ ◄───────── changes[] ────────────  │
 *   │                                    │
 *   │ updateSequence(collection, seq)    │
 *   │ (checkpoint saved to localStorage) │
 * ```
 *
 * @example
 * ```typescript
 * const checkpoint = new CheckpointManager('client-123');
 *
 * // Get current progress for a collection
 * const lastSeq = checkpoint.getSequence('todos'); // 0 initially
 *
 * // After syncing changes up to sequence 42
 * checkpoint.updateSequence('todos', 42);
 *
 * // Later, resume sync from sequence 42
 * const resumeFrom = checkpoint.getSequence('todos'); // 42
 * ```
 *
 * @see {@link SyncEngine} - Uses CheckpointManager internally
 */
export class CheckpointManager {
  private checkpoint: Checkpoint;
  private readonly storageKey: string;

  constructor(nodeId: string, storageKey = 'pocket_sync_checkpoint') {
    this.storageKey = storageKey;
    this.checkpoint = this.loadCheckpoint() ?? {
      id: `${nodeId}_${Date.now()}`,
      sequences: {},
      timestamp: 0,
      nodeId,
    };
  }

  /**
   * Get current checkpoint
   */
  getCheckpoint(): Checkpoint {
    return { ...this.checkpoint };
  }

  /**
   * Get sequence for a collection
   */
  getSequence(collection: string): number {
    return this.checkpoint.sequences[collection] ?? 0;
  }

  /**
   * Update sequence for a collection
   */
  updateSequence(collection: string, sequence: number): void {
    this.checkpoint.sequences[collection] = Math.max(
      this.checkpoint.sequences[collection] ?? 0,
      sequence
    );
    this.checkpoint.timestamp = Date.now();
    this.saveCheckpoint();
  }

  /**
   * Update checkpoint from server
   */
  updateFromServer(serverCheckpoint: Partial<Checkpoint>): void {
    if (serverCheckpoint.sequences) {
      for (const [collection, sequence] of Object.entries(serverCheckpoint.sequences)) {
        this.checkpoint.sequences[collection] = Math.max(
          this.checkpoint.sequences[collection] ?? 0,
          sequence
        );
      }
    }
    this.checkpoint.timestamp = Date.now();
    this.saveCheckpoint();
  }

  /**
   * Reset checkpoint
   */
  reset(): void {
    this.checkpoint = {
      id: `${this.checkpoint.nodeId}_${Date.now()}`,
      sequences: {},
      timestamp: 0,
      nodeId: this.checkpoint.nodeId,
    };
    this.saveCheckpoint();
  }

  /**
   * Load checkpoint from storage
   */
  private loadCheckpoint(): Checkpoint | null {
    if (typeof localStorage === 'undefined') return null;

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Ignore errors
    }
    return null;
  }

  /**
   * Save checkpoint to storage
   */
  private saveCheckpoint(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.checkpoint));
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Serializes a checkpoint to JSON string for network transmission.
 *
 * @param checkpoint - The checkpoint to serialize
 * @returns JSON string representation
 */
export function serializeCheckpoint(checkpoint: Checkpoint): string {
  return JSON.stringify(checkpoint);
}

/**
 * Deserializes a checkpoint from JSON string.
 *
 * @param data - JSON string representation of a checkpoint
 * @returns Parsed Checkpoint object
 */
export function deserializeCheckpoint(data: string): Checkpoint {
  return JSON.parse(data);
}
