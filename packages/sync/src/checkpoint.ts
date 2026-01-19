/**
 * Checkpoint for tracking sync progress
 */
export interface Checkpoint {
  /** Checkpoint ID */
  id: string;
  /** Sequence number per collection */
  sequences: Record<string, number>;
  /** Timestamp of checkpoint */
  timestamp: number;
  /** Node ID that created this checkpoint */
  nodeId: string;
}

/**
 * Checkpoint manager for tracking sync state
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
 * Serialize checkpoint for transmission
 */
export function serializeCheckpoint(checkpoint: Checkpoint): string {
  return JSON.stringify(checkpoint);
}

/**
 * Deserialize checkpoint from transmission
 */
export function deserializeCheckpoint(data: string): Checkpoint {
  return JSON.parse(data);
}
