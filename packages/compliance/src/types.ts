/**
 * Compliance types for GDPR, HIPAA, SOC 2, and CCPA frameworks.
 *
 * @module @pocket/compliance
 */

/**
 * Supported compliance frameworks.
 */
export type ComplianceFramework = 'gdpr' | 'hipaa' | 'soc2' | 'ccpa';

/**
 * Purpose categories for user consent.
 */
export type ConsentPurpose =
  | 'analytics'
  | 'marketing'
  | 'personalization'
  | 'essential'
  | 'third-party';

/**
 * Data classification levels.
 */
export type DataClassification =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'restricted'
  | 'pii'
  | 'phi';

/**
 * Compliance configuration.
 */
export interface ComplianceConfig {
  /** Active compliance frameworks */
  frameworks: ComplianceFramework[];
  /** Data classification settings */
  dataClassification: DataClassification;
  /** Whether consent management is enabled */
  consentEnabled: boolean;
  /** Default consent expiration in milliseconds */
  consentExpirationMs: number;
  /** Retention policies */
  retentionPolicies: RetentionPolicy[];
  /** Breach notification window in hours */
  breachNotificationWindowHours: number;
  /** Whether to enable PII detection */
  piiDetectionEnabled: boolean;
}

/**
 * A record of user consent for a specific purpose.
 */
export interface ConsentRecord {
  /** Unique consent record ID */
  id: string;
  /** User who granted or withdrew consent */
  userId: string;
  /** Purpose of the consent */
  purpose: ConsentPurpose;
  /** Whether consent was granted */
  granted: boolean;
  /** Timestamp when consent was recorded */
  timestamp: number;
  /** When the consent expires (if applicable) */
  expiresAt: number | null;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * A data subject request (DSAR) under GDPR or similar frameworks.
 */
export interface DataSubjectRequest {
  /** Unique request ID */
  id: string;
  /** Type of request */
  type: 'access' | 'erasure' | 'rectification' | 'portability' | 'restriction';
  /** The data subject's user ID */
  subjectId: string;
  /** Current status of the request */
  status: 'pending' | 'in-progress' | 'completed' | 'rejected';
  /** When the request was created */
  createdAt: number;
  /** When the request was last updated */
  updatedAt: number;
  /** When the request was completed */
  completedAt: number | null;
}

/**
 * Result of a compliance check.
 */
export interface ComplianceCheckResult {
  /** Framework the check was run against */
  framework: ComplianceFramework;
  /** Whether all checks passed */
  passed: boolean;
  /** Individual check results */
  checks: ComplianceCheck[];
}

/**
 * An individual compliance check item.
 */
export interface ComplianceCheck {
  /** Name of the check */
  name: string;
  /** Check status */
  status: 'pass' | 'warn' | 'fail';
  /** Human-readable message */
  message: string;
  /** Recommendation for fixing failures */
  recommendation: string;
}

/**
 * A breach notification record.
 */
export interface BreachNotification {
  /** Unique breach ID */
  id: string;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Number of affected records */
  affectedRecords: number;
  /** Description of the breach */
  description: string;
  /** When the breach was detected */
  detectedAt: number;
  /** When authorities/users were notified */
  notifiedAt: number | null;
  /** Current status */
  status: 'detected' | 'investigating' | 'contained' | 'resolved' | 'notified';
}

/**
 * A data retention policy for a collection.
 */
export interface RetentionPolicy {
  /** Collection name the policy applies to */
  collection: string;
  /** Maximum age of documents in milliseconds */
  maxAge: number;
  /** Action to take when documents expire */
  action: 'delete' | 'archive' | 'anonymize';
}

/**
 * A generated compliance report.
 */
export interface ComplianceReport {
  /** Unique report ID */
  id: string;
  /** Framework the report covers */
  framework: ComplianceFramework;
  /** When the report was generated */
  generatedAt: number;
  /** Reporting period */
  period: { start: number; end: number };
  /** Summary of findings */
  summary: string;
  /** Detailed check results */
  checks: ComplianceCheck[];
  /** Actionable recommendations */
  recommendations: string[];
}

/**
 * Default compliance configuration.
 *
 * @example
 * ```typescript
 * import { DEFAULT_COMPLIANCE_CONFIG } from '@pocket/compliance';
 *
 * const config = { ...DEFAULT_COMPLIANCE_CONFIG, frameworks: ['gdpr', 'hipaa'] };
 * ```
 */
export const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = {
  frameworks: ['gdpr'],
  dataClassification: 'internal',
  consentEnabled: true,
  consentExpirationMs: 365 * 24 * 60 * 60 * 1000, // 1 year
  retentionPolicies: [],
  breachNotificationWindowHours: 72,
  piiDetectionEnabled: true,
};
