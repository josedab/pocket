/**
 * ComplianceReporter - Compliance report generation for Pocket.
 *
 * Generates compliance reports, runs audits across frameworks,
 * and provides actionable recommendations for improving compliance
 * posture across GDPR, HIPAA, SOC 2, and CCPA.
 *
 * @module @pocket/compliance
 *
 * @example
 * ```typescript
 * import { createComplianceReporter } from '@pocket/compliance';
 *
 * const reporter = createComplianceReporter({ frameworks: ['gdpr', 'hipaa'] });
 * const report = reporter.generateReport('gdpr', { start: startTime, end: endTime });
 * const text = reporter.exportReport(report, 'text');
 * ```
 *
 * @see {@link GDPRManager} for GDPR-specific compliance management
 * @see {@link RetentionEngine} for data retention policies
 */

import type {
  ComplianceCheck,
  ComplianceCheckResult,
  ComplianceConfig,
  ComplianceFramework,
  ComplianceReport,
} from './types.js';
import { DEFAULT_COMPLIANCE_CONFIG } from './types.js';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Generates compliance reports and audit results.
 *
 * Supports multiple compliance frameworks and produces detailed
 * reports with check results and prioritized recommendations.
 */
export class ComplianceReporter {
  private readonly config: ComplianceConfig;

  constructor(config: Partial<ComplianceConfig> = {}) {
    this.config = { ...DEFAULT_COMPLIANCE_CONFIG, ...config };
  }

  /**
   * Generate a compliance report for a specific framework.
   *
   * @param framework - The compliance framework to report on
   * @param period - Optional reporting period (defaults to last 30 days)
   * @returns A complete compliance report
   *
   * @example
   * ```typescript
   * const report = reporter.generateReport('gdpr', {
   *   start: Date.now() - 30 * 24 * 60 * 60 * 1000,
   *   end: Date.now(),
   * });
   * ```
   */
  generateReport(
    framework: ComplianceFramework,
    period?: { start: number; end: number }
  ): ComplianceReport {
    const now = Date.now();
    const reportPeriod = period ?? {
      start: now - 30 * 24 * 60 * 60 * 1000,
      end: now,
    };

    const checks = this.runFrameworkChecks(framework);
    const failedChecks = checks.filter((c) => c.status === 'fail');
    const warnChecks = checks.filter((c) => c.status === 'warn');

    const summary =
      failedChecks.length === 0
        ? `All ${framework.toUpperCase()} compliance checks passed` +
          (warnChecks.length > 0 ? ` with ${warnChecks.length} warning(s)` : '')
        : `${failedChecks.length} compliance check(s) failed for ${framework.toUpperCase()}`;

    const recommendations = checks.filter((c) => c.recommendation).map((c) => c.recommendation);

    return {
      id: generateId(),
      framework,
      generatedAt: now,
      period: reportPeriod,
      summary,
      checks,
      recommendations,
    };
  }

  /**
   * Run a full audit across all configured compliance frameworks.
   *
   * @returns Array of compliance check results, one per framework
   *
   * @example
   * ```typescript
   * const results = reporter.runFullAudit();
   * for (const result of results) {
   *   console.log(`${result.framework}: ${result.passed ? 'PASS' : 'FAIL'}`);
   * }
   * ```
   */
  runFullAudit(): ComplianceCheckResult[] {
    return this.config.frameworks.map((framework) => {
      const checks = this.runFrameworkChecks(framework);
      const passed = checks.every((c) => c.status !== 'fail');
      return { framework, passed, checks };
    });
  }

  /**
   * Get prioritized recommendations for a framework.
   *
   * @param framework - The compliance framework
   * @returns Prioritized list of recommendations
   *
   * @example
   * ```typescript
   * const recs = reporter.getRecommendations('hipaa');
   * for (const rec of recs) {
   *   console.log(`[${rec.priority}] ${rec.recommendation} (${rec.effort})`);
   * }
   * ```
   */
  getRecommendations(
    framework: ComplianceFramework
  ): { priority: 'high' | 'medium' | 'low'; recommendation: string; effort: string }[] {
    const recommendations: {
      priority: 'high' | 'medium' | 'low';
      recommendation: string;
      effort: string;
    }[] = [];

    if (!this.config.consentEnabled && (framework === 'gdpr' || framework === 'ccpa')) {
      recommendations.push({
        priority: 'high',
        recommendation: 'Enable consent management for user data processing',
        effort: 'low',
      });
    }

    if (this.config.retentionPolicies.length === 0) {
      recommendations.push({
        priority: 'high',
        recommendation: 'Define data retention policies for all collections',
        effort: 'medium',
      });
    }

    if (!this.config.piiDetectionEnabled) {
      recommendations.push({
        priority: 'medium',
        recommendation: 'Enable PII detection to identify personal data in documents',
        effort: 'low',
      });
    }

    if (framework === 'hipaa') {
      recommendations.push({
        priority: 'high',
        recommendation: 'Implement access controls for PHI data',
        effort: 'high',
      });
      recommendations.push({
        priority: 'medium',
        recommendation: 'Configure audit logging for all PHI access',
        effort: 'medium',
      });
    }

    if (framework === 'soc2') {
      recommendations.push({
        priority: 'medium',
        recommendation: 'Implement change management procedures',
        effort: 'medium',
      });
      recommendations.push({
        priority: 'low',
        recommendation: 'Document incident response procedures',
        effort: 'low',
      });
    }

    return recommendations;
  }

  /**
   * Export a compliance report to the specified format.
   *
   * @param report - The report to export
   * @param format - Export format ('json' or 'text')
   * @returns The formatted report string
   *
   * @example
   * ```typescript
   * const report = reporter.generateReport('gdpr');
   * const json = reporter.exportReport(report, 'json');
   * const text = reporter.exportReport(report, 'text');
   * ```
   */
  exportReport(report: ComplianceReport, format: 'json' | 'text'): string {
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }

    const lines: string[] = [
      `Compliance Report: ${report.framework.toUpperCase()}`,
      `Generated: ${new Date(report.generatedAt).toISOString()}`,
      `Period: ${new Date(report.period.start).toISOString()} - ${new Date(report.period.end).toISOString()}`,
      '',
      `Summary: ${report.summary}`,
      '',
      'Checks:',
    ];

    for (const check of report.checks) {
      const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      lines.push(`  ${icon} ${check.name}: ${check.message}`);
      if (check.recommendation) {
        lines.push(`    → ${check.recommendation}`);
      }
    }

    if (report.recommendations.length > 0) {
      lines.push('', 'Recommendations:');
      for (const rec of report.recommendations) {
        lines.push(`  • ${rec}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    // No resources to clean up currently
  }

  /**
   * Run compliance checks for a specific framework.
   */
  private runFrameworkChecks(framework: ComplianceFramework): ComplianceCheck[] {
    switch (framework) {
      case 'gdpr':
        return this.runGDPRChecks();
      case 'hipaa':
        return this.runHIPAAChecks();
      case 'soc2':
        return this.runSOC2Checks();
      case 'ccpa':
        return this.runCCPAChecks();
      default:
        return [];
    }
  }

  private runGDPRChecks(): ComplianceCheck[] {
    return [
      {
        name: 'consent-management',
        status: this.config.consentEnabled ? 'pass' : 'fail',
        message: this.config.consentEnabled
          ? 'Consent management enabled'
          : 'Consent management disabled',
        recommendation: this.config.consentEnabled
          ? ''
          : 'Enable consent management for GDPR compliance',
      },
      {
        name: 'data-retention',
        status: this.config.retentionPolicies.length > 0 ? 'pass' : 'warn',
        message: `${this.config.retentionPolicies.length} retention policies configured`,
        recommendation:
          this.config.retentionPolicies.length > 0
            ? ''
            : 'Define retention policies for personal data',
      },
      {
        name: 'breach-notification',
        status: this.config.breachNotificationWindowHours <= 72 ? 'pass' : 'fail',
        message: `Notification window: ${this.config.breachNotificationWindowHours}h`,
        recommendation:
          this.config.breachNotificationWindowHours <= 72
            ? ''
            : 'Reduce to 72 hours per GDPR Article 33',
      },
      {
        name: 'pii-detection',
        status: this.config.piiDetectionEnabled ? 'pass' : 'warn',
        message: this.config.piiDetectionEnabled
          ? 'PII detection enabled'
          : 'PII detection disabled',
        recommendation: this.config.piiDetectionEnabled
          ? ''
          : 'Enable PII detection for data discovery',
      },
    ];
  }

  private runHIPAAChecks(): ComplianceCheck[] {
    return [
      {
        name: 'phi-classification',
        status:
          this.config.dataClassification === 'phi' ||
          this.config.dataClassification === 'restricted'
            ? 'pass'
            : 'warn',
        message: `Data classification: ${this.config.dataClassification}`,
        recommendation: 'Ensure PHI data is classified as "phi" or "restricted"',
      },
      {
        name: 'data-retention',
        status: this.config.retentionPolicies.length > 0 ? 'pass' : 'fail',
        message: `${this.config.retentionPolicies.length} retention policies configured`,
        recommendation:
          this.config.retentionPolicies.length > 0
            ? ''
            : 'HIPAA requires retention policies for PHI',
      },
      {
        name: 'breach-notification',
        status: this.config.breachNotificationWindowHours <= 1440 ? 'pass' : 'fail',
        message: `Notification window: ${this.config.breachNotificationWindowHours}h`,
        recommendation: 'HIPAA requires breach notification within 60 days',
      },
    ];
  }

  private runSOC2Checks(): ComplianceCheck[] {
    return [
      {
        name: 'data-classification',
        status: this.config.dataClassification !== 'public' ? 'pass' : 'fail',
        message: `Data classification: ${this.config.dataClassification}`,
        recommendation:
          this.config.dataClassification === 'public' ? 'Set appropriate data classification' : '',
      },
      {
        name: 'retention-policy',
        status: this.config.retentionPolicies.length > 0 ? 'pass' : 'warn',
        message: `${this.config.retentionPolicies.length} retention policies configured`,
        recommendation:
          this.config.retentionPolicies.length > 0 ? '' : 'Define data retention policies',
      },
      {
        name: 'change-management',
        status: 'warn',
        message: 'Change management procedures should be documented',
        recommendation: 'Implement and document change management procedures',
      },
    ];
  }

  private runCCPAChecks(): ComplianceCheck[] {
    return [
      {
        name: 'consent-management',
        status: this.config.consentEnabled ? 'pass' : 'fail',
        message: this.config.consentEnabled
          ? 'Consent management enabled'
          : 'Consent management disabled',
        recommendation: this.config.consentEnabled
          ? ''
          : 'Enable consent management for CCPA compliance',
      },
      {
        name: 'data-access',
        status: 'pass',
        message: 'Data subject access capabilities available',
        recommendation: '',
      },
      {
        name: 'data-deletion',
        status: 'pass',
        message: 'Data deletion capabilities available',
        recommendation: '',
      },
    ];
  }
}

/**
 * Create a ComplianceReporter instance.
 *
 * @param config - Optional compliance configuration overrides
 * @returns A new ComplianceReporter instance
 *
 * @example
 * ```typescript
 * const reporter = createComplianceReporter({ frameworks: ['gdpr', 'soc2'] });
 * ```
 */
export function createComplianceReporter(config?: Partial<ComplianceConfig>): ComplianceReporter {
  return new ComplianceReporter(config);
}
