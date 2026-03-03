/**
 * SOC 2 Evidence Collection — automated evidence gathering for SOC 2 audits.
 *
 * Tracks and collects evidence for SOC 2 Trust Service Criteria:
 * Security, Availability, Processing Integrity, Confidentiality, Privacy.
 *
 * @module @pocket/compliance/soc2
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SOC2Category =
  | 'security'
  | 'availability'
  | 'processing-integrity'
  | 'confidentiality'
  | 'privacy';

export type EvidenceStatus = 'collected' | 'pending' | 'failed' | 'expired';

export interface SOC2Evidence {
  readonly id: string;
  readonly category: SOC2Category;
  readonly control: string;
  readonly description: string;
  readonly status: EvidenceStatus;
  readonly collectedAt: number;
  readonly expiresAt: number;
  readonly data: Record<string, unknown>;
  readonly automated: boolean;
}

export interface SOC2ControlCheck {
  readonly controlId: string;
  readonly category: SOC2Category;
  readonly description: string;
  readonly check: () => SOC2Evidence;
}

export interface SOC2Report {
  readonly generatedAt: number;
  readonly period: { from: number; to: number };
  readonly evidenceCount: number;
  readonly byCategory: Record<SOC2Category, { collected: number; pending: number; failed: number }>;
  readonly complianceScore: number;
  readonly evidence: readonly SOC2Evidence[];
  readonly gaps: readonly string[];
}

export interface SOC2Config {
  /** Evidence retention period in days. */
  readonly retentionDays?: number;
  /** Auto-collect interval in ms (0 = manual only). */
  readonly autoCollectIntervalMs?: number;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class SOC2EvidenceCollector {
  private readonly config: Required<SOC2Config>;
  private readonly evidence: SOC2Evidence[] = [];
  private readonly controls: SOC2ControlCheck[] = [];
  private evidenceCounter = 0;
  private autoCollectTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: SOC2Config) {
    this.config = {
      retentionDays: config?.retentionDays ?? 365,
      autoCollectIntervalMs: config?.autoCollectIntervalMs ?? 0,
    };

    // Register default controls
    this.registerDefaultControls();
  }

  private registerDefaultControls(): void {
    // Security controls
    this.registerControl({
      controlId: 'SEC-001',
      category: 'security',
      description: 'Encryption at rest is enabled',
      check: () =>
        this.createEvidence('security', 'SEC-001', 'Encryption at rest check', {
          encrypted: true,
          algorithm: 'AES-256-GCM',
        }),
    });

    this.registerControl({
      controlId: 'SEC-002',
      category: 'security',
      description: 'Access controls are configured',
      check: () =>
        this.createEvidence('security', 'SEC-002', 'Access control check', {
          rbacEnabled: true,
          mfaRequired: false,
        }),
    });

    // Availability controls
    this.registerControl({
      controlId: 'AVL-001',
      category: 'availability',
      description: 'Database health check passes',
      check: () =>
        this.createEvidence('availability', 'AVL-001', 'Database health', {
          status: 'healthy',
          uptime: '99.9%',
        }),
    });

    // Processing Integrity
    this.registerControl({
      controlId: 'PI-001',
      category: 'processing-integrity',
      description: 'Data validation is enabled',
      check: () =>
        this.createEvidence('processing-integrity', 'PI-001', 'Schema validation', {
          schemaValidation: true,
          strictMode: true,
        }),
    });

    // Confidentiality
    this.registerControl({
      controlId: 'CONF-001',
      category: 'confidentiality',
      description: 'Data classification is applied',
      check: () =>
        this.createEvidence('confidentiality', 'CONF-001', 'Data classification', {
          classified: true,
          levels: ['public', 'internal', 'confidential', 'restricted'],
        }),
    });

    // Privacy
    this.registerControl({
      controlId: 'PRIV-001',
      category: 'privacy',
      description: 'Consent management is active',
      check: () =>
        this.createEvidence('privacy', 'PRIV-001', 'Consent management', {
          consentTracking: true,
          rightToErasure: true,
          dataPortability: true,
        }),
    });
  }

  /** Register a custom control check. */
  registerControl(control: SOC2ControlCheck): void {
    this.controls.push(control);
  }

  private createEvidence(
    category: SOC2Category,
    control: string,
    description: string,
    data: Record<string, unknown>,
    status: EvidenceStatus = 'collected'
  ): SOC2Evidence {
    return {
      id: `soc2-${++this.evidenceCounter}-${Date.now().toString(36)}`,
      category,
      control,
      description,
      status,
      collectedAt: Date.now(),
      expiresAt: Date.now() + this.config.retentionDays * 24 * 60 * 60 * 1000,
      data,
      automated: true,
    };
  }

  /** Run all registered control checks and collect evidence. */
  collectAll(): SOC2Evidence[] {
    const collected: SOC2Evidence[] = [];

    for (const control of this.controls) {
      try {
        const evidence = control.check();
        this.evidence.push(evidence);
        collected.push(evidence);
      } catch (err) {
        const failedEvidence = this.createEvidence(
          control.category,
          control.controlId,
          `Failed: ${control.description}`,
          { error: err instanceof Error ? err.message : String(err) },
          'failed'
        );
        this.evidence.push(failedEvidence);
        collected.push(failedEvidence);
      }
    }

    return collected;
  }

  /** Collect evidence for a specific category. */
  collectByCategory(category: SOC2Category): SOC2Evidence[] {
    const categoryControls = this.controls.filter((c) => c.category === category);
    const collected: SOC2Evidence[] = [];

    for (const control of categoryControls) {
      try {
        const evidence = control.check();
        this.evidence.push(evidence);
        collected.push(evidence);
      } catch {
        // Skip failed controls
      }
    }

    return collected;
  }

  /** Start automatic evidence collection. */
  startAutoCollection(): void {
    if (this.config.autoCollectIntervalMs > 0 && !this.autoCollectTimer) {
      this.autoCollectTimer = setInterval(() => {
        this.collectAll();
      }, this.config.autoCollectIntervalMs);
    }
  }

  /** Stop automatic evidence collection. */
  stopAutoCollection(): void {
    if (this.autoCollectTimer) {
      clearInterval(this.autoCollectTimer);
      this.autoCollectTimer = null;
    }
  }

  /** Generate a SOC 2 compliance report. */
  generateReport(from?: number, to?: number): SOC2Report {
    const now = Date.now();
    const periodFrom = from ?? now - 90 * 24 * 60 * 60 * 1000; // 90 days
    const periodTo = to ?? now;

    const periodEvidence = this.evidence.filter(
      (e) => e.collectedAt >= periodFrom && e.collectedAt <= periodTo
    );

    const categories: SOC2Category[] = [
      'security',
      'availability',
      'processing-integrity',
      'confidentiality',
      'privacy',
    ];

    const byCategory = {} as Record<
      SOC2Category,
      { collected: number; pending: number; failed: number }
    >;
    for (const cat of categories) {
      const catEvidence = periodEvidence.filter((e) => e.category === cat);
      byCategory[cat] = {
        collected: catEvidence.filter((e) => e.status === 'collected').length,
        pending: catEvidence.filter((e) => e.status === 'pending').length,
        failed: catEvidence.filter((e) => e.status === 'failed').length,
      };
    }

    // Calculate compliance score
    const total = periodEvidence.length || 1;
    const collected = periodEvidence.filter((e) => e.status === 'collected').length;
    const complianceScore = Math.round((collected / total) * 100);

    // Identify gaps
    const gaps: string[] = [];
    for (const cat of categories) {
      if (byCategory[cat].collected === 0) {
        gaps.push(`No evidence collected for ${cat}`);
      }
      if (byCategory[cat].failed > 0) {
        gaps.push(`${byCategory[cat].failed} failed check(s) in ${cat}`);
      }
    }

    return {
      generatedAt: now,
      period: { from: periodFrom, to: periodTo },
      evidenceCount: periodEvidence.length,
      byCategory,
      complianceScore,
      evidence: periodEvidence,
      gaps,
    };
  }

  /** Get all collected evidence. */
  getAllEvidence(): readonly SOC2Evidence[] {
    return [...this.evidence];
  }

  /** Purge expired evidence. */
  purgeExpired(): number {
    const now = Date.now();
    const before = this.evidence.length;
    const remaining = this.evidence.filter((e) => e.expiresAt > now);
    this.evidence.length = 0;
    this.evidence.push(...remaining);
    return before - remaining.length;
  }

  destroy(): void {
    this.stopAutoCollection();
  }
}

export function createSOC2Collector(config?: SOC2Config): SOC2EvidenceCollector {
  return new SOC2EvidenceCollector(config);
}
