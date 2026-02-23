/**
 * ComplianceEngine — GDPR, SOC2, and data retention policy framework.
 *
 * Provides automated user data export/deletion, immutable audit trail
 * with hash chaining, and configurable data retention policies.
 */

// ── Types ──────────────────────────────────────────────────

export interface ComplianceEngineConfig {
  /** Enable GDPR compliance features (default: true) */
  gdpr?: boolean;
  /** Enable audit trail (default: true) */
  auditTrail?: boolean;
  /** Audit log max entries before rotation (default: 100000) */
  maxAuditEntries?: number;
  /** Data retention policies */
  retentionPolicies?: EngineRetentionPolicy[];
}

export interface EngineRetentionPolicy {
  collection: string;
  maxAgeDays: number;
  action: 'delete' | 'archive' | 'anonymize';
  field?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: 'read' | 'write' | 'delete' | 'export' | 'consent';
  userId: string;
  collection: string;
  documentId: string;
  details: string;
  previousHash: string;
  hash: string;
}

export interface GDPRExportResult {
  userId: string;
  exportedAt: number;
  collections: Record<string, Record<string, unknown>[]>;
  totalDocuments: number;
  format: 'json';
}

export interface GDPRDeletionResult {
  userId: string;
  deletedAt: number;
  collectionsAffected: string[];
  documentsDeleted: number;
  auditEntryId: string;
}

export interface RetentionResult {
  collection: string;
  policy: EngineRetentionPolicy;
  documentsProcessed: number;
  documentsRetained: number;
  documentsExpired: number;
  processedAt: number;
}

export interface ComplianceEngineReport {
  gdprEnabled: boolean;
  auditTrailEnabled: boolean;
  auditEntries: number;
  retentionPolicies: number;
  lastRetentionRun: number | null;
  chainValid: boolean;
}

// ── Implementation ────────────────────────────────────────

export class ComplianceEngine {
  private readonly config: Required<ComplianceEngineConfig>;
  private readonly auditLog: AuditEntry[] = [];
  private readonly consentStore = new Map<
    string,
    { userId: string; consents: Record<string, boolean>; updatedAt: number }
  >();
  private auditCounter = 0;
  private lastRetentionRun: number | null = null;

  constructor(config: ComplianceEngineConfig = {}) {
    this.config = {
      gdpr: config.gdpr ?? true,
      auditTrail: config.auditTrail ?? true,
      maxAuditEntries: config.maxAuditEntries ?? 100000,
      retentionPolicies: config.retentionPolicies ?? [],
    };
  }

  // ── GDPR ──────────────────────────────────────────────

  /**
   * Export all data for a specific user (GDPR Article 20 — Right to Data Portability).
   */
  exportUserData(
    userId: string,
    dataSource: Record<string, Record<string, unknown>[]>
  ): GDPRExportResult {
    const collections: Record<string, Record<string, unknown>[]> = {};
    let total = 0;

    for (const [collection, docs] of Object.entries(dataSource)) {
      const userDocs = docs.filter(
        (d) => d.userId === userId || d._createdBy === userId || d.ownerId === userId
      );
      if (userDocs.length > 0) {
        collections[collection] = userDocs;
        total += userDocs.length;
      }
    }

    this.recordAudit('export', userId, '*', '*', `GDPR data export: ${total} documents`);

    return {
      userId,
      exportedAt: Date.now(),
      collections,
      totalDocuments: total,
      format: 'json',
    };
  }

  /**
   * Delete all data for a specific user (GDPR Article 17 — Right to Erasure).
   */
  deleteUserData(
    userId: string,
    dataSource: Record<string, Record<string, unknown>[]>
  ): GDPRDeletionResult {
    const affected: string[] = [];
    let deleted = 0;

    for (const [collection, docs] of Object.entries(dataSource)) {
      const before = docs.length;
      const remaining = docs.filter(
        (d) => d.userId !== userId && d._createdBy !== userId && d.ownerId !== userId
      );
      const removedCount = before - remaining.length;

      if (removedCount > 0) {
        affected.push(collection);
        deleted += removedCount;
        // Replace array contents in-place
        docs.length = 0;
        docs.push(...remaining);
      }
    }

    const auditId = this.recordAudit(
      'delete',
      userId,
      '*',
      '*',
      `GDPR erasure: ${deleted} documents from ${affected.length} collections`
    );

    return {
      userId,
      deletedAt: Date.now(),
      collectionsAffected: affected,
      documentsDeleted: deleted,
      auditEntryId: auditId,
    };
  }

  // ── Consent Management ────────────────────────────────

  /**
   * Record user consent for specific purposes.
   */
  recordConsent(userId: string, consents: Record<string, boolean>): void {
    this.consentStore.set(userId, { userId, consents, updatedAt: Date.now() });
    this.recordAudit(
      'consent',
      userId,
      '_consent',
      userId,
      `Consent updated: ${JSON.stringify(consents)}`
    );
  }

  /**
   * Check if user has given consent for a purpose.
   */
  hasConsent(userId: string, purpose: string): boolean {
    const entry = this.consentStore.get(userId);
    return entry?.consents[purpose] === true;
  }

  /**
   * Get all consents for a user.
   */
  getUserConsents(userId: string): Record<string, boolean> | null {
    return this.consentStore.get(userId)?.consents ?? null;
  }

  // ── Audit Trail ───────────────────────────────────────

  /**
   * Record an audit event with hash chain integrity.
   */
  recordAudit(
    action: AuditEntry['action'],
    userId: string,
    collection: string,
    documentId: string,
    details: string
  ): string {
    if (!this.config.auditTrail) return '';

    const id = `audit_${++this.auditCounter}`;
    const previousHash =
      this.auditLog.length > 0 ? this.auditLog[this.auditLog.length - 1]!.hash : '0000000000';

    const entry: AuditEntry = {
      id,
      timestamp: Date.now(),
      action,
      userId,
      collection,
      documentId,
      details,
      previousHash,
      hash: this.computeHash(
        `${id}:${previousHash}:${action}:${userId}:${collection}:${documentId}:${details}`
      ),
    };

    this.auditLog.push(entry);

    if (this.auditLog.length > this.config.maxAuditEntries) {
      this.auditLog.splice(0, this.auditLog.length - this.config.maxAuditEntries);
    }

    return id;
  }

  /**
   * Get audit log entries.
   */
  getAuditLog(filter?: { userId?: string; action?: string; since?: number }): AuditEntry[] {
    let entries = [...this.auditLog];
    if (filter?.userId) entries = entries.filter((e) => e.userId === filter.userId);
    if (filter?.action) entries = entries.filter((e) => e.action === filter.action);
    if (filter?.since) entries = entries.filter((e) => e.timestamp >= filter.since!);
    return entries;
  }

  /**
   * Verify the integrity of the audit chain.
   */
  verifyAuditChain(): { valid: boolean; brokenAt: number | null } {
    for (let i = 1; i < this.auditLog.length; i++) {
      if (this.auditLog[i]!.previousHash !== this.auditLog[i - 1]!.hash) {
        return { valid: false, brokenAt: i };
      }
    }
    return { valid: true, brokenAt: null };
  }

  // ── Data Retention ────────────────────────────────────

  /**
   * Apply retention policies to data.
   */
  applyRetention(
    dataSource: Record<string, (Record<string, unknown> & { createdAt?: number })[]>
  ): RetentionResult[] {
    const results: RetentionResult[] = [];

    for (const policy of this.config.retentionPolicies) {
      const docs = dataSource[policy.collection];
      if (!docs) continue;

      const cutoff = Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
      const dateField = policy.field ?? 'createdAt';
      let expired = 0;

      if (policy.action === 'delete') {
        const before = docs.length;
        const remaining = docs.filter((d) => {
          const ts = d[dateField] as number | undefined;
          return !ts || ts > cutoff;
        });
        expired = before - remaining.length;
        docs.length = 0;
        docs.push(...remaining);
      } else if (policy.action === 'anonymize') {
        for (const doc of docs) {
          const ts = doc[dateField] as number | undefined;
          if (ts && ts <= cutoff) {
            doc.userId = 'anonymized';
            doc.email = 'anonymized@example.com';
            doc.name = 'Anonymized User';
            expired++;
          }
        }
      }

      results.push({
        collection: policy.collection,
        policy,
        documentsProcessed: docs.length + expired,
        documentsRetained: docs.length,
        documentsExpired: expired,
        processedAt: Date.now(),
      });
    }

    this.lastRetentionRun = Date.now();
    return results;
  }

  // ── Reports ───────────────────────────────────────────

  /**
   * Generate a compliance report.
   */
  getReport(): ComplianceEngineReport {
    const chainVerification = this.verifyAuditChain();
    return {
      gdprEnabled: this.config.gdpr,
      auditTrailEnabled: this.config.auditTrail,
      auditEntries: this.auditLog.length,
      retentionPolicies: this.config.retentionPolicies.length,
      lastRetentionRun: this.lastRetentionRun,
      chainValid: chainVerification.valid,
    };
  }

  // ── Private ────────────────────────────────────────────

  private computeHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return `h_${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }
}

export function createComplianceEngine(config?: ComplianceEngineConfig): ComplianceEngine {
  return new ComplianceEngine(config);
}
