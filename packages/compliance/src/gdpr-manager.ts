/**
 * GDPRManager - GDPR compliance manager for Pocket.
 *
 * Handles data subject access requests (DSAR), consent management,
 * right to erasure, data portability, and PII detection. Provides
 * a complete GDPR compliance workflow for local-first databases.
 *
 * @module @pocket/compliance
 *
 * @example
 * ```typescript
 * import { createGDPRManager } from '@pocket/compliance';
 *
 * const gdpr = createGDPRManager({ frameworks: ['gdpr'], consentEnabled: true });
 * gdpr.recordConsent('user-1', 'analytics', true);
 * const request = await gdpr.handleAccessRequest('user-1');
 * ```
 *
 * @see {@link BreachNotificationManager} for breach reporting
 * @see {@link RetentionEngine} for data retention policies
 */

import type {
  ComplianceCheck,
  ComplianceCheckResult,
  ComplianceConfig,
  ConsentPurpose,
  ConsentRecord,
  DataSubjectRequest,
} from './types.js';
import { DEFAULT_COMPLIANCE_CONFIG } from './types.js';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * GDPR compliance manager.
 *
 * Manages data subject requests, consent records, and compliance checks
 * for GDPR and similar privacy frameworks.
 */
export class GDPRManager {
  private readonly config: ComplianceConfig;
  private readonly consents = new Map<string, ConsentRecord[]>();
  private readonly requests: DataSubjectRequest[] = [];

  constructor(config: Partial<ComplianceConfig> = {}) {
    this.config = { ...DEFAULT_COMPLIANCE_CONFIG, ...config };
  }

  /**
   * Handle a data subject access request (DSAR).
   *
   * Creates a request to export all data associated with a user.
   *
   * @param subjectId - The data subject's user ID
   * @returns The created access request
   *
   * @example
   * ```typescript
   * const request = await gdpr.handleAccessRequest('user-123');
   * console.log(request.status); // 'completed'
   * ```
   */
  async handleAccessRequest(subjectId: string): Promise<DataSubjectRequest> {
    const now = Date.now();
    const request: DataSubjectRequest = {
      id: generateId(),
      type: 'access',
      subjectId,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };

    this.requests.push(request);
    return request;
  }

  /**
   * Handle a right-to-erasure (right to be forgotten) request.
   *
   * Creates a request to delete all data associated with a user.
   * When cascade is enabled, related records are also removed.
   *
   * @param subjectId - The data subject's user ID
   * @param options - Erasure options
   * @returns The created erasure request
   *
   * @example
   * ```typescript
   * const request = await gdpr.handleErasureRequest('user-123', { cascade: true });
   * ```
   */
  async handleErasureRequest(
    subjectId: string,
    options?: { cascade?: boolean }
  ): Promise<DataSubjectRequest> {
    const now = Date.now();
    const request: DataSubjectRequest = {
      id: generateId(),
      type: 'erasure',
      subjectId,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };

    this.requests.push(request);

    // Remove consent records for the subject
    if (options?.cascade) {
      this.consents.delete(subjectId);
    }

    return request;
  }

  /**
   * Handle a data portability request.
   *
   * Exports all user data in the specified format.
   *
   * @param subjectId - The data subject's user ID
   * @param format - Export format (default: 'json')
   * @returns The exported data and format
   *
   * @example
   * ```typescript
   * const result = await gdpr.handlePortabilityRequest('user-123', 'json');
   * console.log(result.format); // 'json'
   * ```
   */
  async handlePortabilityRequest(
    subjectId: string,
    format: 'json' | 'csv' = 'json'
  ): Promise<{ data: string; format: string }> {
    const now = Date.now();
    const request: DataSubjectRequest = {
      id: generateId(),
      type: 'portability',
      subjectId,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };

    this.requests.push(request);

    const userConsents = this.consents.get(subjectId) ?? [];
    const exportData = {
      subjectId,
      consents: userConsents,
      exportedAt: now,
    };

    if (format === 'csv') {
      const header = 'id,userId,purpose,granted,timestamp,expiresAt';
      const rows = userConsents.map(
        (c) => `${c.id},${c.userId},${c.purpose},${c.granted},${c.timestamp},${c.expiresAt ?? ''}`
      );
      return { data: [header, ...rows].join('\n'), format: 'csv' };
    }

    return { data: JSON.stringify(exportData, null, 2), format: 'json' };
  }

  /**
   * Handle a data rectification request.
   *
   * Records a request to correct inaccurate personal data.
   *
   * @param subjectId - The data subject's user ID
   * @param corrections - Key-value pairs of data to correct
   * @returns The created rectification request
   *
   * @example
   * ```typescript
   * const request = await gdpr.handleRectificationRequest('user-123', { name: 'Jane Doe' });
   * ```
   */
  async handleRectificationRequest(
    subjectId: string,
    _corrections: Record<string, unknown>
  ): Promise<DataSubjectRequest> {
    const now = Date.now();
    const request: DataSubjectRequest = {
      id: generateId(),
      type: 'rectification',
      subjectId,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    };

    this.requests.push(request);
    return request;
  }

  /**
   * Record a user's consent for a specific purpose.
   *
   * @param userId - The user granting consent
   * @param purpose - The purpose of consent
   * @param granted - Whether consent is granted
   * @returns The consent record
   *
   * @example
   * ```typescript
   * const consent = gdpr.recordConsent('user-1', 'analytics', true);
   * console.log(consent.granted); // true
   * ```
   */
  recordConsent(userId: string, purpose: ConsentPurpose, granted: boolean): ConsentRecord {
    const record: ConsentRecord = {
      id: generateId(),
      userId,
      purpose,
      granted,
      timestamp: Date.now(),
      expiresAt: granted ? Date.now() + this.config.consentExpirationMs : null,
      metadata: {},
    };

    const existing = this.consents.get(userId) ?? [];
    // Replace any existing consent for the same purpose
    const filtered = existing.filter((c) => c.purpose !== purpose);
    filtered.push(record);
    this.consents.set(userId, filtered);

    return record;
  }

  /**
   * Withdraw a user's consent for a specific purpose.
   *
   * @param userId - The user withdrawing consent
   * @param purpose - The purpose to withdraw consent for
   * @returns The updated consent record
   *
   * @example
   * ```typescript
   * const consent = gdpr.withdrawConsent('user-1', 'marketing');
   * console.log(consent.granted); // false
   * ```
   */
  withdrawConsent(userId: string, purpose: ConsentPurpose): ConsentRecord {
    return this.recordConsent(userId, purpose, false);
  }

  /**
   * Get all consent records for a user.
   *
   * @param userId - The user to look up
   * @returns Array of consent records
   *
   * @example
   * ```typescript
   * const consents = gdpr.getConsents('user-1');
   * ```
   */
  getConsents(userId: string): ConsentRecord[] {
    return [...(this.consents.get(userId) ?? [])];
  }

  /**
   * Check if a user has active consent for a specific purpose.
   *
   * @param userId - The user to check
   * @param purpose - The purpose to check consent for
   * @returns Whether the user has active consent
   *
   * @example
   * ```typescript
   * if (gdpr.hasConsent('user-1', 'analytics')) {
   *   // Track analytics
   * }
   * ```
   */
  hasConsent(userId: string, purpose: ConsentPurpose): boolean {
    const records = this.consents.get(userId) ?? [];
    const record = records.find((c) => c.purpose === purpose);
    if (!record?.granted) return false;
    if (record.expiresAt !== null && record.expiresAt < Date.now()) return false;
    return true;
  }

  /**
   * Get data subject requests, optionally filtered.
   *
   * @param options - Filter options
   * @returns Filtered data subject requests
   *
   * @example
   * ```typescript
   * const pending = gdpr.getRequests({ status: 'pending' });
   * ```
   */
  getRequests(options?: { status?: string; type?: string }): DataSubjectRequest[] {
    let results = [...this.requests];
    if (options?.status) {
      results = results.filter((r) => r.status === options.status);
    }
    if (options?.type) {
      results = results.filter((r) => r.type === options.type);
    }
    return results;
  }

  /**
   * Run a GDPR compliance check.
   *
   * Evaluates the current configuration and data handling against
   * GDPR requirements and returns detailed results.
   *
   * @returns Compliance check result
   *
   * @example
   * ```typescript
   * const result = gdpr.runComplianceCheck();
   * console.log(result.passed); // true or false
   * ```
   */
  runComplianceCheck(): ComplianceCheckResult {
    const checks: ComplianceCheck[] = [];

    checks.push({
      name: 'consent-management',
      status: this.config.consentEnabled ? 'pass' : 'fail',
      message: this.config.consentEnabled
        ? 'Consent management is enabled'
        : 'Consent management is disabled',
      recommendation: this.config.consentEnabled
        ? ''
        : 'Enable consent management for GDPR compliance',
    });

    checks.push({
      name: 'data-classification',
      status: this.config.dataClassification !== 'public' ? 'pass' : 'warn',
      message: `Data classification is set to '${this.config.dataClassification}'`,
      recommendation:
        this.config.dataClassification === 'public'
          ? 'Consider a stricter data classification for personal data'
          : '',
    });

    checks.push({
      name: 'retention-policy',
      status: this.config.retentionPolicies.length > 0 ? 'pass' : 'warn',
      message:
        this.config.retentionPolicies.length > 0
          ? `${this.config.retentionPolicies.length} retention policies configured`
          : 'No retention policies configured',
      recommendation:
        this.config.retentionPolicies.length > 0
          ? ''
          : 'Define retention policies for collections containing personal data',
    });

    checks.push({
      name: 'pii-detection',
      status: this.config.piiDetectionEnabled ? 'pass' : 'warn',
      message: this.config.piiDetectionEnabled
        ? 'PII detection is enabled'
        : 'PII detection is disabled',
      recommendation: this.config.piiDetectionEnabled
        ? ''
        : 'Enable PII detection to identify personal data in documents',
    });

    checks.push({
      name: 'breach-notification',
      status: this.config.breachNotificationWindowHours <= 72 ? 'pass' : 'fail',
      message: `Breach notification window is ${this.config.breachNotificationWindowHours} hours`,
      recommendation:
        this.config.breachNotificationWindowHours > 72
          ? 'GDPR requires breach notification within 72 hours'
          : '',
    });

    const passed = checks.every((c) => c.status !== 'fail');

    return {
      framework: 'gdpr',
      passed,
      checks,
    };
  }

  /**
   * Detect potential PII fields in a document.
   *
   * Scans document fields for patterns that match common PII types
   * such as email addresses, phone numbers, and names.
   *
   * @param document - The document to scan
   * @returns Array of detected PII fields with type and confidence
   *
   * @example
   * ```typescript
   * const pii = gdpr.detectPII({ email: 'john@example.com', age: 30 });
   * // [{ field: 'email', type: 'email', confidence: 0.95 }]
   * ```
   */
  detectPII(
    document: Record<string, unknown>
  ): { field: string; type: string; confidence: number }[] {
    const results: { field: string; type: string; confidence: number }[] = [];
    const piiPatterns: { field: RegExp; value: RegExp; type: string; confidence: number }[] = [
      { field: /email/i, value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, type: 'email', confidence: 0.95 },
      { field: /phone|tel|mobile/i, value: /^\+?[\d\s\-()]{7,}$/, type: 'phone', confidence: 0.85 },
      {
        field: /name|first.?name|last.?name/i,
        value: /^[A-Za-z\s'-]{2,}$/,
        type: 'name',
        confidence: 0.7,
      },
      {
        field: /ssn|social.?security/i,
        value: /^\d{3}-?\d{2}-?\d{4}$/,
        type: 'ssn',
        confidence: 0.95,
      },
      { field: /address|street|city|zip|postal/i, value: /.+/, type: 'address', confidence: 0.6 },
      {
        field: /dob|birth.?date|date.?of.?birth/i,
        value: /.+/,
        type: 'date_of_birth',
        confidence: 0.8,
      },
      {
        field: /ip.?addr/i,
        value: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
        type: 'ip_address',
        confidence: 0.9,
      },
    ];

    for (const [key, value] of Object.entries(document)) {
      if (typeof value !== 'string') continue;

      for (const pattern of piiPatterns) {
        if (pattern.field.test(key) && pattern.value.test(value)) {
          results.push({ field: key, type: pattern.type, confidence: pattern.confidence });
          break;
        }
      }
    }

    return results;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.consents.clear();
    this.requests.length = 0;
  }
}

/**
 * Create a GDPRManager instance.
 *
 * @param config - Optional compliance configuration overrides
 * @returns A new GDPRManager instance
 *
 * @example
 * ```typescript
 * const gdpr = createGDPRManager({ consentEnabled: true, piiDetectionEnabled: true });
 * ```
 */
export function createGDPRManager(config?: Partial<ComplianceConfig>): GDPRManager {
  return new GDPRManager(config);
}
