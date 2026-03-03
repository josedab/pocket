// Types
export { DEFAULT_COMPLIANCE_CONFIG } from './types.js';
export type {
  BreachNotification,
  ComplianceCheck,
  ComplianceCheckResult,
  ComplianceConfig,
  ComplianceFramework,
  ComplianceReport,
  ConsentPurpose,
  ConsentRecord,
  DataClassification,
  DataSubjectRequest,
  RetentionPolicy,
} from './types.js';

// GDPR Manager
export { GDPRManager, createGDPRManager } from './gdpr-manager.js';

// Breach Notification
export {
  BreachNotificationManager,
  createBreachNotificationManager,
} from './breach-notification.js';

// Retention Engine
export { RetentionEngine, createRetentionEngine } from './retention-engine.js';

// Compliance Reporter
export { ComplianceReporter, createComplianceReporter } from './compliance-reporter.js';

// Compliance Engine
export { ComplianceEngine, createComplianceEngine } from './compliance-engine.js';
export type {
  AuditEntry,
  ComplianceEngineConfig,
  ComplianceEngineReport,
  EngineRetentionPolicy,
  GDPRDeletionResult,
  GDPRExportResult,
  RetentionResult,
} from './compliance-engine.js';

// HIPAA Audit Logging
export {
  HIPAAAuditLogger,
  createHIPAAAuditLogger,
  type HIPAAAnomaly,
  type HIPAAConfig,
  type HIPAAReport,
  type PHIAccessLog,
} from './hipaa-audit.js';

// SOC 2 Evidence Collection
export {
  SOC2EvidenceCollector,
  createSOC2Collector,
  type EvidenceStatus,
  type SOC2Category,
  type SOC2Config,
  type SOC2ControlCheck,
  type SOC2Evidence,
  type SOC2Report,
} from './soc2-evidence.js';
