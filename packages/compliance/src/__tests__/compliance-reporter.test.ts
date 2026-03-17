import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComplianceReporter, createComplianceReporter } from '../compliance-reporter.js';

describe('ComplianceReporter', () => {
  let reporter: ComplianceReporter;

  beforeEach(() => {
    reporter = createComplianceReporter();
  });

  afterEach(() => {
    reporter.dispose();
  });

  // ── Factory ──────────────────────────────────────────────

  describe('createComplianceReporter factory', () => {
    it('should create with default config', () => {
      expect(reporter).toBeInstanceOf(ComplianceReporter);
    });

    it('should accept partial config overrides', () => {
      const custom = createComplianceReporter({
        frameworks: ['gdpr', 'hipaa', 'soc2'],
        consentEnabled: false,
      });
      expect(custom).toBeInstanceOf(ComplianceReporter);
      custom.dispose();
    });
  });

  // ── Generate Report ──────────────────────────────────────

  describe('generateReport', () => {
    it('should generate a GDPR report', () => {
      const report = reporter.generateReport('gdpr');
      expect(report.framework).toBe('gdpr');
      expect(report.id).toBeTruthy();
      expect(report.generatedAt).toBeGreaterThan(0);
      expect(report.checks.length).toBeGreaterThan(0);
    });

    it('should generate a HIPAA report', () => {
      const report = reporter.generateReport('hipaa');
      expect(report.framework).toBe('hipaa');
      expect(report.checks.length).toBeGreaterThan(0);
    });

    it('should generate a SOC2 report', () => {
      const report = reporter.generateReport('soc2');
      expect(report.framework).toBe('soc2');
      expect(report.checks.length).toBeGreaterThan(0);
    });

    it('should generate a CCPA report', () => {
      const report = reporter.generateReport('ccpa');
      expect(report.framework).toBe('ccpa');
      expect(report.checks.length).toBeGreaterThan(0);
    });

    it('should use custom period when provided', () => {
      const start = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const end = Date.now();
      const report = reporter.generateReport('gdpr', { start, end });
      expect(report.period.start).toBe(start);
      expect(report.period.end).toBe(end);
    });

    it('should use default 30-day period when none specified', () => {
      const report = reporter.generateReport('gdpr');
      const periodLength = report.period.end - report.period.start;
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(periodLength).toBeCloseTo(thirtyDaysMs, -4);
    });

    it('should include summary for passing checks', () => {
      const report = reporter.generateReport('gdpr');
      expect(report.summary).toContain('GDPR');
    });

    it('should include summary indicating failures', () => {
      const failing = createComplianceReporter({ consentEnabled: false });
      const report = failing.generateReport('gdpr');
      expect(report.summary).toContain('failed');
      failing.dispose();
    });

    it('should include summary with warnings count', () => {
      // Default config should pass but may have warnings (no retention policies)
      const report = reporter.generateReport('gdpr');
      if (report.checks.some((c) => c.status === 'warn')) {
        expect(report.summary).toContain('warning');
      }
    });

    it('should include recommendations for failing/warning checks', () => {
      const failing = createComplianceReporter({
        consentEnabled: false,
        piiDetectionEnabled: false,
      });
      const report = failing.generateReport('gdpr');
      expect(report.recommendations.length).toBeGreaterThan(0);
      failing.dispose();
    });
  });

  // ── GDPR-Specific Checks ────────────────────────────────

  describe('GDPR checks', () => {
    it('should pass consent check when enabled', () => {
      const report = reporter.generateReport('gdpr');
      const check = report.checks.find((c) => c.name === 'consent-management');
      expect(check?.status).toBe('pass');
    });

    it('should fail consent check when disabled', () => {
      const r = createComplianceReporter({ consentEnabled: false });
      const report = r.generateReport('gdpr');
      const check = report.checks.find((c) => c.name === 'consent-management');
      expect(check?.status).toBe('fail');
      r.dispose();
    });

    it('should warn on no retention policies', () => {
      const report = reporter.generateReport('gdpr');
      const check = report.checks.find((c) => c.name === 'data-retention');
      expect(check?.status).toBe('warn');
    });

    it('should pass retention check with policies', () => {
      const r = createComplianceReporter({
        retentionPolicies: [{ collection: 'logs', maxAge: 1000, action: 'delete' }],
      });
      const report = r.generateReport('gdpr');
      const check = report.checks.find((c) => c.name === 'data-retention');
      expect(check?.status).toBe('pass');
      r.dispose();
    });

    it('should pass breach notification within 72 hours', () => {
      const report = reporter.generateReport('gdpr');
      const check = report.checks.find((c) => c.name === 'breach-notification');
      expect(check?.status).toBe('pass');
    });

    it('should fail breach notification over 72 hours', () => {
      const r = createComplianceReporter({ breachNotificationWindowHours: 96 });
      const report = r.generateReport('gdpr');
      const check = report.checks.find((c) => c.name === 'breach-notification');
      expect(check?.status).toBe('fail');
      r.dispose();
    });

    it('should check PII detection', () => {
      const report = reporter.generateReport('gdpr');
      const check = report.checks.find((c) => c.name === 'pii-detection');
      expect(check?.status).toBe('pass');
    });
  });

  // ── HIPAA-Specific Checks ────────────────────────────────

  describe('HIPAA checks', () => {
    it('should check PHI classification', () => {
      const report = reporter.generateReport('hipaa');
      const check = report.checks.find((c) => c.name === 'phi-classification');
      expect(check).toBeDefined();
    });

    it('should pass PHI classification for phi data', () => {
      const r = createComplianceReporter({ dataClassification: 'phi' });
      const report = r.generateReport('hipaa');
      const check = report.checks.find((c) => c.name === 'phi-classification');
      expect(check?.status).toBe('pass');
      r.dispose();
    });

    it('should pass PHI classification for restricted data', () => {
      const r = createComplianceReporter({ dataClassification: 'restricted' });
      const report = r.generateReport('hipaa');
      const check = report.checks.find((c) => c.name === 'phi-classification');
      expect(check?.status).toBe('pass');
      r.dispose();
    });

    it('should warn on non-PHI classification', () => {
      const report = reporter.generateReport('hipaa');
      const check = report.checks.find((c) => c.name === 'phi-classification');
      expect(check?.status).toBe('warn');
    });

    it('should fail retention check without policies', () => {
      const report = reporter.generateReport('hipaa');
      const check = report.checks.find((c) => c.name === 'data-retention');
      expect(check?.status).toBe('fail');
    });
  });

  // ── SOC2-Specific Checks ─────────────────────────────────

  describe('SOC2 checks', () => {
    it('should check data classification', () => {
      const report = reporter.generateReport('soc2');
      const check = report.checks.find((c) => c.name === 'data-classification');
      expect(check).toBeDefined();
      expect(check?.status).toBe('pass'); // default is 'internal'
    });

    it('should fail data classification for public', () => {
      const r = createComplianceReporter({ dataClassification: 'public' });
      const report = r.generateReport('soc2');
      const check = report.checks.find((c) => c.name === 'data-classification');
      expect(check?.status).toBe('fail');
      r.dispose();
    });

    it('should include change management warning', () => {
      const report = reporter.generateReport('soc2');
      const check = report.checks.find((c) => c.name === 'change-management');
      expect(check?.status).toBe('warn');
    });
  });

  // ── CCPA-Specific Checks ─────────────────────────────────

  describe('CCPA checks', () => {
    it('should check consent management', () => {
      const report = reporter.generateReport('ccpa');
      const check = report.checks.find((c) => c.name === 'consent-management');
      expect(check?.status).toBe('pass');
    });

    it('should include data access check', () => {
      const report = reporter.generateReport('ccpa');
      const check = report.checks.find((c) => c.name === 'data-access');
      expect(check?.status).toBe('pass');
    });

    it('should include data deletion check', () => {
      const report = reporter.generateReport('ccpa');
      const check = report.checks.find((c) => c.name === 'data-deletion');
      expect(check?.status).toBe('pass');
    });
  });

  // ── Full Audit ───────────────────────────────────────────

  describe('runFullAudit', () => {
    it('should run audit for all configured frameworks', () => {
      const r = createComplianceReporter({ frameworks: ['gdpr', 'hipaa', 'soc2'] });
      const results = r.runFullAudit();
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.framework)).toEqual(['gdpr', 'hipaa', 'soc2']);
      r.dispose();
    });

    it('should default to GDPR only', () => {
      const results = reporter.runFullAudit();
      expect(results).toHaveLength(1);
      expect(results[0]!.framework).toBe('gdpr');
    });

    it('should indicate pass/fail for each framework', () => {
      const results = reporter.runFullAudit();
      for (const result of results) {
        expect(typeof result.passed).toBe('boolean');
        expect(result.checks.length).toBeGreaterThan(0);
      }
    });

    it('should report failure when checks fail', () => {
      const r = createComplianceReporter({
        frameworks: ['gdpr'],
        consentEnabled: false,
      });
      const results = r.runFullAudit();
      expect(results[0]!.passed).toBe(false);
      r.dispose();
    });

    it('should audit all four frameworks', () => {
      const r = createComplianceReporter({
        frameworks: ['gdpr', 'hipaa', 'soc2', 'ccpa'],
      });
      const results = r.runFullAudit();
      expect(results).toHaveLength(4);
      r.dispose();
    });
  });

  // ── Recommendations ──────────────────────────────────────

  describe('getRecommendations', () => {
    it('should provide GDPR recommendations when consent disabled', () => {
      const r = createComplianceReporter({ consentEnabled: false });
      const recs = r.getRecommendations('gdpr');
      expect(recs.some((r) => r.recommendation.includes('consent'))).toBe(true);
      expect(recs.some((r) => r.priority === 'high')).toBe(true);
      r.dispose();
    });

    it('should provide retention policy recommendations', () => {
      const recs = reporter.getRecommendations('gdpr');
      expect(recs.some((r) => r.recommendation.includes('retention'))).toBe(true);
    });

    it('should provide PII detection recommendations when disabled', () => {
      const r = createComplianceReporter({ piiDetectionEnabled: false });
      const recs = r.getRecommendations('gdpr');
      expect(recs.some((r) => r.recommendation.includes('PII'))).toBe(true);
      r.dispose();
    });

    it('should provide HIPAA-specific recommendations', () => {
      const recs = reporter.getRecommendations('hipaa');
      expect(recs.some((r) => r.recommendation.includes('PHI'))).toBe(true);
      expect(recs.some((r) => r.recommendation.includes('audit logging'))).toBe(true);
    });

    it('should provide SOC2-specific recommendations', () => {
      const recs = reporter.getRecommendations('soc2');
      expect(recs.some((r) => r.recommendation.includes('change management'))).toBe(true);
      expect(recs.some((r) => r.recommendation.includes('incident response'))).toBe(true);
    });

    it('should provide CCPA consent recommendation when disabled', () => {
      const r = createComplianceReporter({ consentEnabled: false });
      const recs = r.getRecommendations('ccpa');
      expect(recs.some((r) => r.recommendation.includes('consent'))).toBe(true);
      r.dispose();
    });

    it('should include effort estimates', () => {
      const recs = reporter.getRecommendations('hipaa');
      for (const rec of recs) {
        expect(['low', 'medium', 'high']).toContain(rec.effort);
      }
    });

    it('should include priority levels', () => {
      const recs = reporter.getRecommendations('soc2');
      for (const rec of recs) {
        expect(['low', 'medium', 'high']).toContain(rec.priority);
      }
    });
  });

  // ── Export Report ────────────────────────────────────────

  describe('exportReport', () => {
    it('should export as JSON', () => {
      const report = reporter.generateReport('gdpr');
      const json = reporter.exportReport(report, 'json');
      const parsed = JSON.parse(json);
      expect(parsed.framework).toBe('gdpr');
      expect(parsed.checks).toBeDefined();
    });

    it('should export as text', () => {
      const report = reporter.generateReport('gdpr');
      const text = reporter.exportReport(report, 'text');
      expect(text).toContain('Compliance Report: GDPR');
      expect(text).toContain('Summary:');
      expect(text).toContain('Checks:');
    });

    it('should include check status icons in text format', () => {
      const report = reporter.generateReport('gdpr');
      const text = reporter.exportReport(report, 'text');
      // Should have at least one check icon (✓, ⚠, or ✗)
      expect(text).toMatch(/[✓⚠✗]/);
    });

    it('should include recommendations in text format', () => {
      const failing = createComplianceReporter({
        consentEnabled: false,
        piiDetectionEnabled: false,
      });
      const report = failing.generateReport('gdpr');
      const text = failing.exportReport(report, 'text');
      expect(text).toContain('Recommendations:');
      expect(text).toContain('•');
      failing.dispose();
    });

    it('should include period dates in text format', () => {
      const report = reporter.generateReport('gdpr');
      const text = reporter.exportReport(report, 'text');
      expect(text).toContain('Period:');
    });

    it('should handle report with no recommendations in text format', () => {
      const passing = createComplianceReporter({
        consentEnabled: true,
        piiDetectionEnabled: true,
        retentionPolicies: [{ collection: 'logs', maxAge: 1000, action: 'delete' }],
        breachNotificationWindowHours: 72,
      });
      const report = passing.generateReport('gdpr');
      const text = passing.exportReport(report, 'text');
      // All checks pass, so recommendations from checks should be empty strings
      // which still get included. But the report.recommendations array should be sparse.
      expect(text).toContain('Compliance Report: GDPR');
      passing.dispose();
    });
  });

  // ── Dispose ──────────────────────────────────────────────

  describe('dispose', () => {
    it('should not throw on dispose', () => {
      expect(() => reporter.dispose()).not.toThrow();
    });

    it('should be safe to call dispose multiple times', () => {
      expect(() => {
        reporter.dispose();
        reporter.dispose();
      }).not.toThrow();
    });
  });
});
