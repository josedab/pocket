/**
 * Relay reconnection tracking and message deduplication.
 *
 * Tracks client reconnections, assigns reconnection IDs, and
 * uses a sliding-window dedup set to prevent duplicate message
 * delivery after reconnect.
 *
 * @module relay-dedup
 */

/** Configuration for the dedup layer */
export interface RelayDedupConfig {
  /** Maximum dedup window entries per tenant (default: 10000) */
  readonly maxWindowSize?: number;
  /** Dedup entry TTL in milliseconds (default: 300000 = 5 min) */
  readonly entryTtlMs?: number;
}

/** A dedup entry */
interface DedupEntry {
  messageId: string;
  timestamp: number;
}

/**
 * Message deduplication tracker for relay reconnections.
 *
 * @example
 * ```typescript
 * const dedup = new RelayDedup({ maxWindowSize: 5000 });
 *
 * // Before delivering a message:
 * if (dedup.isDuplicate('tenant-1', 'msg-abc123')) {
 *   return; // Skip duplicate
 * }
 * dedup.record('tenant-1', 'msg-abc123');
 * // deliver message...
 * ```
 */
export class RelayDedup {
  private readonly config: Required<RelayDedupConfig>;
  private readonly windows = new Map<string, DedupEntry[]>();

  constructor(config: RelayDedupConfig = {}) {
    this.config = {
      maxWindowSize: config.maxWindowSize ?? 10_000,
      entryTtlMs: config.entryTtlMs ?? 300_000,
    };
  }

  /** Check if a message ID has been seen for this tenant */
  isDuplicate(tenantId: string, messageId: string): boolean {
    const window = this.windows.get(tenantId);
    if (!window) return false;
    this.pruneExpired(window);
    return window.some((e) => e.messageId === messageId);
  }

  /** Record a message ID as delivered */
  record(tenantId: string, messageId: string): void {
    let window = this.windows.get(tenantId);
    if (!window) {
      window = [];
      this.windows.set(tenantId, window);
    }

    this.pruneExpired(window);

    // Don't record duplicates
    if (window.some((e) => e.messageId === messageId)) return;

    window.push({ messageId, timestamp: Date.now() });

    // Enforce max window size
    while (window.length > this.config.maxWindowSize) {
      window.shift();
    }
  }

  /** Generate a unique message ID */
  generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /** Get the number of tracked messages for a tenant */
  getWindowSize(tenantId: string): number {
    const window = this.windows.get(tenantId);
    if (!window) return 0;
    this.pruneExpired(window);
    return window.length;
  }

  /** Clear all tracking for a tenant */
  clearTenant(tenantId: string): void {
    this.windows.delete(tenantId);
  }

  /** Clear all tracking */
  clear(): void {
    this.windows.clear();
  }

  private pruneExpired(window: DedupEntry[]): void {
    const cutoff = Date.now() - this.config.entryTtlMs;
    while (window.length > 0 && window[0]!.timestamp < cutoff) {
      window.shift();
    }
  }
}

/** Factory function */
export function createRelayDedup(config?: RelayDedupConfig): RelayDedup {
  return new RelayDedup(config);
}
