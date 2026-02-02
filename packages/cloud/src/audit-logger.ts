/**
 * AuditLogger - Append-only audit log for compliance tracking.
 *
 * Provides an in-memory audit log with querying, export, and real-time
 * event streaming for tracking all operations in Pocket Cloud.
 *
 * @module audit-logger
 */

import { Subject, takeUntil, type Observable } from 'rxjs';

/**
 * Actions that can be recorded in the audit log.
 *
 * @see {@link AuditEntry.action}
 */
export type AuditAction =
  | 'sync.push'
  | 'sync.pull'
  | 'auth.login'
  | 'auth.logout'
  | 'data.read'
  | 'data.write'
  | 'data.delete'
  | 'key.create'
  | 'key.revoke'
  | 'config.change';

/**
 * A single audit log entry.
 *
 * @example
 * ```typescript
 * const entry: AuditEntry = {
 *   id: 'aud_abc123',
 *   timestamp: Date.now(),
 *   tenantId: 'tenant-a',
 *   action: 'data.write',
 *   resource: 'collection:todos',
 *   details: 'Created 3 documents',
 *   userId: 'user-1',
 * };
 * ```
 *
 * @see {@link AuditLogger.log}
 */
export interface AuditEntry {
  /** Unique audit entry identifier */
  id: string;

  /** Timestamp when the action occurred */
  timestamp: number;

  /** Tenant that performed the action */
  tenantId: string;

  /** The action that was performed */
  action: AuditAction;

  /** The resource that was acted upon */
  resource: string;

  /** Human-readable details about the action */
  details: string;

  /** Optional user identifier */
  userId?: string;

  /** Optional IP address of the requester */
  ipAddress?: string;
}

/**
 * Input for logging an audit entry (id and timestamp are auto-generated).
 *
 * @see {@link AuditLogger.log}
 */
export type AuditEntryInput = Omit<AuditEntry, 'id' | 'timestamp'>;

/**
 * Filters for querying audit log entries.
 *
 * @example
 * ```typescript
 * const filter: AuditQueryFilter = {
 *   tenantId: 'tenant-a',
 *   action: 'data.write',
 *   dateRange: { start: Date.now() - 86_400_000, end: Date.now() },
 * };
 * ```
 *
 * @see {@link AuditLogger.query}
 */
export interface AuditQueryFilter {
  /** Filter by tenant identifier */
  tenantId?: string;

  /** Filter by action type */
  action?: AuditAction;

  /** Filter by date range */
  dateRange?: {
    /** Start of the date range (inclusive) */
    start: number;
    /** End of the date range (inclusive) */
    end: number;
  };

  /** Filter by user identifier */
  userId?: string;
}

/**
 * Append-only audit logger for compliance tracking.
 *
 * AuditLogger provides:
 * - Append-only in-memory log store
 * - Querying with filters (tenant, action, date range, user)
 * - Export in JSON or CSV format
 * - Real-time event stream via RxJS Subject
 *
 * @example Basic usage
 * ```typescript
 * import { createAuditLogger } from '@pocket/cloud';
 *
 * const logger = createAuditLogger();
 *
 * // Log an action
 * const entry = logger.log({
 *   tenantId: 'tenant-a',
 *   action: 'data.write',
 *   resource: 'collection:todos',
 *   details: 'Created 3 documents',
 *   userId: 'user-1',
 * });
 *
 * // Query entries
 * const results = logger.query({ tenantId: 'tenant-a' });
 *
 * // Export as CSV
 * const csv = logger.export('csv');
 *
 * logger.destroy();
 * ```
 *
 * @example Real-time event stream
 * ```typescript
 * const logger = createAuditLogger();
 *
 * logger.getEntries$().subscribe(entry => {
 *   console.log('Audit event:', entry.action, entry.resource);
 * });
 *
 * logger.log({
 *   tenantId: 'tenant-a',
 *   action: 'auth.login',
 *   resource: 'session',
 *   details: 'User logged in',
 * });
 * ```
 *
 * @see {@link createAuditLogger}
 * @see {@link AuditEntry}
 */
export class AuditLogger {
  private readonly destroy$ = new Subject<void>();
  private readonly entries$ = new Subject<AuditEntry>();
  private readonly entries: AuditEntry[] = [];

  private idCounter = 0;

  /**
   * Log an audit entry.
   *
   * Appends the entry to the in-memory store and emits it on the
   * real-time event stream. The entry id and timestamp are auto-generated.
   *
   * @param input - The audit entry data (without id and timestamp)
   * @returns The complete audit entry with generated id and timestamp
   *
   * @example
   * ```typescript
   * const entry = logger.log({
   *   tenantId: 'tenant-a',
   *   action: 'sync.push',
   *   resource: 'collection:notes',
   *   details: 'Pushed 10 changes',
   * });
   * console.log(entry.id); // 'aud_1'
   * ```
   */
  log(input: AuditEntryInput): AuditEntry {
    this.idCounter++;
    const entry: AuditEntry = {
      id: `aud_${this.idCounter}`,
      timestamp: Date.now(),
      ...input,
    };

    this.entries.push(entry);
    this.entries$.next(entry);
    return entry;
  }

  /**
   * Query audit log entries with optional filters.
   *
   * Returns entries matching all provided filters (AND logic).
   * If no filters are provided, returns all entries.
   *
   * @param filter - Optional query filters
   * @returns Array of matching audit entries
   *
   * @example
   * ```typescript
   * // Get all write actions for a tenant in the last hour
   * const results = logger.query({
   *   tenantId: 'tenant-a',
   *   action: 'data.write',
   *   dateRange: { start: Date.now() - 3_600_000, end: Date.now() },
   * });
   * ```
   */
  query(filter?: AuditQueryFilter): AuditEntry[] {
    if (!filter) {
      return [...this.entries];
    }

    return this.entries.filter((entry) => {
      if (filter.tenantId && entry.tenantId !== filter.tenantId) return false;
      if (filter.action && entry.action !== filter.action) return false;
      if (filter.userId && entry.userId !== filter.userId) return false;
      if (filter.dateRange) {
        if (entry.timestamp < filter.dateRange.start) return false;
        if (entry.timestamp > filter.dateRange.end) return false;
      }
      return true;
    });
  }

  /**
   * Export audit log entries in the specified format.
   *
   * @param format - Export format: 'json' or 'csv'
   * @param filter - Optional query filters to export a subset
   * @returns Formatted string of audit entries
   *
   * @example
   * ```typescript
   * const json = logger.export('json');
   * const csv = logger.export('csv', { tenantId: 'tenant-a' });
   * ```
   */
  export(format: 'json' | 'csv', filter?: AuditQueryFilter): string {
    const entries = this.query(filter);

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV format
    const headers = ['id', 'timestamp', 'tenantId', 'action', 'resource', 'details', 'userId', 'ipAddress'];
    const rows = entries.map((entry) =>
      headers
        .map((header) => {
          const value = entry[header as keyof AuditEntry] ?? '';
          const str = String(value);
          // Escape fields containing commas, quotes, or newlines
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Get the total number of audit entries.
   *
   * @returns Count of entries in the log
   */
  getCount(): number {
    return this.entries.length;
  }

  /**
   * Get an observable stream of real-time audit events.
   *
   * @returns Observable that emits each new audit entry as it is logged
   *
   * @example
   * ```typescript
   * logger.getEntries$().subscribe(entry => {
   *   console.log('New audit event:', entry.action);
   * });
   * ```
   */
  getEntries$(): Observable<AuditEntry> {
    return this.entries$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Clear all audit log entries.
   *
   * @example
   * ```typescript
   * logger.clear();
   * console.log(logger.getCount()); // 0
   * ```
   */
  clear(): void {
    this.entries.length = 0;
  }

  /**
   * Permanently destroy the audit logger and release all resources.
   *
   * Completes all observables. After calling destroy(), the logger
   * cannot be reused.
   *
   * @example
   * ```typescript
   * logger.destroy();
   * ```
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.entries$.complete();
  }
}

/**
 * Create an audit logger instance.
 *
 * Factory function that creates a new {@link AuditLogger}.
 *
 * @returns A new AuditLogger instance
 *
 * @example
 * ```typescript
 * import { createAuditLogger } from '@pocket/cloud';
 *
 * const logger = createAuditLogger();
 *
 * logger.log({
 *   tenantId: 'tenant-a',
 *   action: 'data.write',
 *   resource: 'collection:todos',
 *   details: 'Created document',
 * });
 * ```
 *
 * @see {@link AuditLogger}
 * @see {@link AuditEntry}
 */
export function createAuditLogger(): AuditLogger {
  return new AuditLogger();
}
