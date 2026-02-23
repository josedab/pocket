import { describe, it, expect, beforeEach } from 'vitest';
import { GDPRManager, createGDPRManager } from '../gdpr-manager.js';
import { BreachNotificationManager, createBreachNotificationManager } from '../breach-notification.js';
import { ComplianceReporter, createComplianceReporter } from '../compliance-reporter.js';
import { RetentionEngine, createRetentionEngine } from '../retention-engine.js';

describe('Compliance Package', () => {
  describe('GDPRManager', () => {
    let gdpr: GDPRManager;

    beforeEach(() => {
      gdpr = createGDPRManager();
    });

    it('should create via factory', () => {
      expect(gdpr).toBeInstanceOf(GDPRManager);
    });

    it('should handle data subject access request', async () => {
      const request = await gdpr.handleAccessRequest('user-123');
      expect(request).toBeDefined();
      expect(request.subjectId).toBe('user-123');
      expect(request.type).toBe('access');
    });

    it('should handle erasure request', async () => {
      const request = await gdpr.handleErasureRequest('user-456');
      expect(request).toBeDefined();
      expect(request.subjectId).toBe('user-456');
      expect(request.type).toBe('erasure');
    });

    it('should record consent', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      const consents = gdpr.getConsents('user-1');
      expect(consents.length).toBeGreaterThan(0);
    });

    it('should check consent', () => {
      gdpr.recordConsent('user-1', 'marketing', true);
      expect(gdpr.hasConsent('user-1', 'marketing')).toBe(true);
      expect(gdpr.hasConsent('user-1', 'unknown-purpose')).toBe(false);
    });

    it('should withdraw consent', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      gdpr.recordConsent('user-1', 'analytics', false);
      expect(gdpr.hasConsent('user-1', 'analytics')).toBe(false);
    });

    it('should list requests', async () => {
      await gdpr.handleAccessRequest('user-1');
      await gdpr.handleErasureRequest('user-2');
      const requests = gdpr.getRequests();
      expect(requests.length).toBe(2);
    });
  });

  describe('BreachNotificationManager', () => {
    let manager: BreachNotificationManager;

    beforeEach(() => {
      manager = createBreachNotificationManager();
    });

    it('should create via factory', () => {
      expect(manager).toBeInstanceOf(BreachNotificationManager);
    });

    it('should report a breach', () => {
      const breach = manager.reportBreach({
        description: 'Unauthorized access detected',
        severity: 'high',
        affectedRecords: 100,
        detectedAt: Date.now(),
      });
      expect(breach).toBeDefined();
      expect(breach.severity).toBe('high');
    });

    it('should list breaches', () => {
      manager.reportBreach({
        description: 'Test breach',
        severity: 'low',
        affectedRecords: 1,
        detectedAt: Date.now(),
      });
      const breaches = manager.getBreaches();
      expect(breaches.length).toBe(1);
    });

    it('should track notification status', () => {
      const breach = manager.reportBreach({
        description: 'Test',
        severity: 'high',
        affectedRecords: 50,
        detectedAt: Date.now(),
      });
      expect(breach.status).toBe('detected');
      expect(breach.notifiedAt).toBeNull();
    });
  });

  describe('ComplianceReporter', () => {
    let reporter: ComplianceReporter;

    beforeEach(() => {
      reporter = createComplianceReporter();
    });

    it('should create via factory', () => {
      expect(reporter).toBeInstanceOf(ComplianceReporter);
    });

    it('should generate GDPR compliance report', () => {
      const report = reporter.generateReport('gdpr');
      expect(report).toBeDefined();
      expect(report.framework).toBe('gdpr');
      expect(report.checks).toBeDefined();
    });

    it('should generate HIPAA compliance report', () => {
      const report = reporter.generateReport('hipaa');
      expect(report.framework).toBe('hipaa');
    });

    it('should generate SOC2 compliance report', () => {
      const report = reporter.generateReport('soc2');
      expect(report.framework).toBe('soc2');
    });

    it('should include check results in report', () => {
      const report = reporter.generateReport('gdpr');
      expect(Array.isArray(report.checks)).toBe(true);
      expect(report.checks.length).toBeGreaterThan(0);
    });
  });

  describe('RetentionEngine', () => {
    let engine: RetentionEngine;

    beforeEach(() => {
      engine = createRetentionEngine();
    });

    it('should create via factory', () => {
      expect(engine).toBeInstanceOf(RetentionEngine);
    });

    it('should create with custom policies', () => {
      const custom = createRetentionEngine([
        { collection: 'logs', maxAgeMs: 30 * 24 * 60 * 60 * 1000, action: 'delete' },
      ]);
      expect(custom).toBeInstanceOf(RetentionEngine);
    });

    it('should evaluate retention for documents', () => {
      const withPolicies = createRetentionEngine([
        { collection: 'logs', maxAge: 1000, action: 'delete' },
      ]);
      const result = withPolicies.evaluate('logs', [
        { _id: '1', _updatedAt: Date.now() - 5000 },
        { _id: '2', _updatedAt: Date.now() },
      ]);
      expect(result.length).toBe(1);
      expect(result[0]!.documentIds).toContain('1');
      expect(result[0]!.documentIds).not.toContain('2');
    });
  });
});
