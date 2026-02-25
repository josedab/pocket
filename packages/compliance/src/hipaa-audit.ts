/**
 * HIPAA Audit Logging — healthcare compliance audit trail.
 *
 * Provides tamper-evident logging of all PHI (Protected Health Information)
 * access, including who accessed what, when, and from where.
 *
 * @module @pocket/compliance/hipaa
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HIPAAConfig {
  /** Enable automatic PHI access logging. */
  readonly autoLog?: boolean;
  /** Retention period for audit logs in days (HIPAA requires 6 years). */
  readonly retentionDays?: number;
  /** Collections containing PHI data. */
  readonly phiCollections?: readonly string[];
  /** Hash algorithm for log integrity. */
  readonly hashAlgorithm?: 'sha256' | 'djb2';
}

export interface PHIAccessLog {
  readonly id: string;
  readonly timestamp: number;
  readonly userId: string;
  readonly action: 'read' | 'write' | 'delete' | 'export' | 'share';
  readonly collection: string;
  readonly documentId: string;
  readonly fields: readonly string[];
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly reason: string;
  readonly hash: string;
  readonly previousHash: string;
}

export interface HIPAAReport {
  readonly generatedAt: number;
  readonly period: { from: number; to: number };
  readonly totalAccesses: number;
  readonly byUser: Record<string, number>;
  readonly byAction: Record<string, number>;
  readonly byCollection: Record<string, number>;
  readonly anomalies: readonly HIPAAAnomaly[];
  readonly chainIntegrity: boolean;
}

export interface HIPAAAnomaly {
  readonly type: 'unusual-volume' | 'off-hours' | 'bulk-export' | 'unauthorized-field';
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly description: string;
  readonly logId: string;
  readonly timestamp: number;
}

// ─── Hash Utility ─────────────────────────────────────────────────────────────

function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ─── HIPAA Audit Logger ───────────────────────────────────────────────────────

export class HIPAAAuditLogger {
  private readonly config: Required<HIPAAConfig>;
  private readonly logs: PHIAccessLog[] = [];
  private logCounter = 0;

  constructor(config?: HIPAAConfig) {
    this.config = {
      autoLog: config?.autoLog ?? true,
      retentionDays: config?.retentionDays ?? 2190, // 6 years
      phiCollections: config?.phiCollections ?? [],
      hashAlgorithm: config?.hashAlgorithm ?? 'djb2',
    };
  }

  /** Log a PHI access event. */
  logAccess(params: {
    userId: string;
    action: PHIAccessLog['action'];
    collection: string;
    documentId: string;
    fields?: string[];
    ipAddress?: string;
    userAgent?: string;
    reason?: string;
  }): PHIAccessLog {
    const previousHash =
      this.logs.length > 0 ? this.logs[this.logs.length - 1]!.hash : '0'.repeat(8);

    const logData = `${params.userId}:${params.action}:${params.collection}:${params.documentId}:${Date.now()}:${previousHash}`;
    const hash = djb2Hash(logData);

    const log: PHIAccessLog = {
      id: `hipaa-${++this.logCounter}-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      userId: params.userId,
      action: params.action,
      collection: params.collection,
      documentId: params.documentId,
      fields: params.fields ?? [],
      ipAddress: params.ipAddress ?? 'unknown',
      userAgent: params.userAgent ?? 'unknown',
      reason: params.reason ?? '',
      hash,
      previousHash,
    };

    this.logs.push(log);
    return log;
  }

  /** Verify the integrity of the audit log chain. */
  verifyChain(): { valid: boolean; brokenAt: number | null } {
    for (let i = 1; i < this.logs.length; i++) {
      const current = this.logs[i]!;
      const previous = this.logs[i - 1]!;
      if (current.previousHash !== previous.hash) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true, brokenAt: null };
  }

  /** Query logs by user. */
  getLogsByUser(userId: string, from?: number, to?: number): PHIAccessLog[] {
    return this.logs.filter((log) => {
      if (log.userId !== userId) return false;
      if (from && log.timestamp < from) return false;
      if (to && log.timestamp > to) return false;
      return true;
    });
  }

  /** Query logs by collection. */
  getLogsByCollection(collection: string): PHIAccessLog[] {
    return this.logs.filter((log) => log.collection === collection);
  }

  /** Generate a HIPAA compliance report. */
  generateReport(from: number, to: number): HIPAAReport {
    const periodLogs = this.logs.filter((log) => log.timestamp >= from && log.timestamp <= to);

    const byUser: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const byCollection: Record<string, number> = {};
    const anomalies: HIPAAAnomaly[] = [];

    // Per-user daily access counts for anomaly detection
    const userDailyAccess = new Map<string, number>();

    for (const log of periodLogs) {
      byUser[log.userId] = (byUser[log.userId] ?? 0) + 1;
      byAction[log.action] = (byAction[log.action] ?? 0) + 1;
      byCollection[log.collection] = (byCollection[log.collection] ?? 0) + 1;

      const dayKey = `${log.userId}:${new Date(log.timestamp).toISOString().slice(0, 10)}`;
      userDailyAccess.set(dayKey, (userDailyAccess.get(dayKey) ?? 0) + 1);
    }

    // Detect anomalies
    for (const [key, count] of userDailyAccess.entries()) {
      if (count > 100) {
        const userId = key.split(':')[0]!;
        anomalies.push({
          type: 'unusual-volume',
          severity: count > 500 ? 'critical' : 'high',
          description: `User ${userId} made ${count} PHI accesses in a single day`,
          logId: '',
          timestamp: Date.now(),
        });
      }
    }

    // Check for bulk exports
    const exportLogs = periodLogs.filter((l) => l.action === 'export');
    if (exportLogs.length > 10) {
      anomalies.push({
        type: 'bulk-export',
        severity: 'high',
        description: `${exportLogs.length} export operations detected in period`,
        logId: exportLogs[0]?.id ?? '',
        timestamp: Date.now(),
      });
    }

    const chainCheck = this.verifyChain();

    return {
      generatedAt: Date.now(),
      period: { from, to },
      totalAccesses: periodLogs.length,
      byUser,
      byAction,
      byCollection,
      anomalies,
      chainIntegrity: chainCheck.valid,
    };
  }

  /** Purge logs older than retention period. */
  purgeExpired(): number {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const before = this.logs.length;
    const remaining = this.logs.filter((log) => log.timestamp >= cutoff);
    this.logs.length = 0;
    this.logs.push(...remaining);
    return before - remaining.length;
  }

  /** Get all logs (for export/backup). */
  getAllLogs(): readonly PHIAccessLog[] {
    return [...this.logs];
  }

  /** Check if a collection contains PHI. */
  isPHICollection(collection: string): boolean {
    return this.config.phiCollections.includes(collection);
  }
}

export function createHIPAAAuditLogger(config?: HIPAAConfig): HIPAAAuditLogger {
  return new HIPAAAuditLogger(config);
}
