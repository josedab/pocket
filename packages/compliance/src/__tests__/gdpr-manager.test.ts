import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GDPRManager, createGDPRManager } from '../gdpr-manager.js';

describe('GDPRManager', () => {
  let gdpr: GDPRManager;

  beforeEach(() => {
    gdpr = createGDPRManager();
  });

  afterEach(() => {
    gdpr.dispose();
  });

  // ── Factory ──────────────────────────────────────────────

  describe('createGDPRManager factory', () => {
    it('should create with default config', () => {
      expect(gdpr).toBeInstanceOf(GDPRManager);
    });

    it('should accept partial config overrides', () => {
      const custom = createGDPRManager({
        consentEnabled: false,
        piiDetectionEnabled: false,
      });
      const result = custom.runComplianceCheck();
      const consentCheck = result.checks.find((c) => c.name === 'consent-management');
      expect(consentCheck?.status).toBe('fail');
      custom.dispose();
    });
  });

  // ── Data Subject Access Requests ─────────────────────────

  describe('handleAccessRequest', () => {
    it('should create a completed access request', async () => {
      const req = await gdpr.handleAccessRequest('user-1');
      expect(req.type).toBe('access');
      expect(req.subjectId).toBe('user-1');
      expect(req.status).toBe('completed');
      expect(req.completedAt).not.toBeNull();
      expect(req.id).toBeTruthy();
    });

    it('should record the request in the internal list', async () => {
      await gdpr.handleAccessRequest('user-1');
      const requests = gdpr.getRequests({ type: 'access' });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.subjectId).toBe('user-1');
    });

    it('should handle multiple requests for the same subject', async () => {
      await gdpr.handleAccessRequest('user-1');
      await gdpr.handleAccessRequest('user-1');
      const requests = gdpr.getRequests({ type: 'access' });
      expect(requests).toHaveLength(2);
    });
  });

  // ── Right to Erasure ─────────────────────────────────────

  describe('handleErasureRequest', () => {
    it('should create a completed erasure request', async () => {
      const req = await gdpr.handleErasureRequest('user-1');
      expect(req.type).toBe('erasure');
      expect(req.subjectId).toBe('user-1');
      expect(req.status).toBe('completed');
    });

    it('should remove consent records when cascade is true', async () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      gdpr.recordConsent('user-1', 'marketing', true);
      expect(gdpr.getConsents('user-1')).toHaveLength(2);

      await gdpr.handleErasureRequest('user-1', { cascade: true });
      expect(gdpr.getConsents('user-1')).toHaveLength(0);
    });

    it('should preserve consent records when cascade is false', async () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      await gdpr.handleErasureRequest('user-1', { cascade: false });
      expect(gdpr.getConsents('user-1')).toHaveLength(1);
    });

    it('should preserve consent records when no options given', async () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      await gdpr.handleErasureRequest('user-1');
      expect(gdpr.getConsents('user-1')).toHaveLength(1);
    });

    it('should not affect other users on cascade', async () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      gdpr.recordConsent('user-2', 'analytics', true);
      await gdpr.handleErasureRequest('user-1', { cascade: true });
      expect(gdpr.getConsents('user-2')).toHaveLength(1);
    });
  });

  // ── Data Portability ─────────────────────────────────────

  describe('handlePortabilityRequest', () => {
    it('should export data in JSON format by default', async () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      const result = await gdpr.handlePortabilityRequest('user-1');
      expect(result.format).toBe('json');
      const parsed = JSON.parse(result.data);
      expect(parsed.subjectId).toBe('user-1');
      expect(parsed.consents).toHaveLength(1);
    });

    it('should export data in CSV format', async () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      const result = await gdpr.handlePortabilityRequest('user-1', 'csv');
      expect(result.format).toBe('csv');
      const lines = result.data.split('\n');
      expect(lines[0]).toBe('id,userId,purpose,granted,timestamp,expiresAt');
      expect(lines).toHaveLength(2); // header + 1 row
    });

    it('should handle user with no consents', async () => {
      const result = await gdpr.handlePortabilityRequest('no-data-user');
      expect(result.format).toBe('json');
      const parsed = JSON.parse(result.data);
      expect(parsed.consents).toHaveLength(0);
    });

    it('should record a portability request', async () => {
      await gdpr.handlePortabilityRequest('user-1');
      const requests = gdpr.getRequests({ type: 'portability' });
      expect(requests).toHaveLength(1);
    });

    it('should export CSV with empty expiresAt for withdrawn consent', async () => {
      gdpr.recordConsent('user-1', 'analytics', false);
      const result = await gdpr.handlePortabilityRequest('user-1', 'csv');
      const dataRow = result.data.split('\n')[1]!;
      expect(dataRow).toMatch(/,false,/);
      expect(dataRow.endsWith(',')).toBe(true);
    });
  });

  // ── Rectification ────────────────────────────────────────

  describe('handleRectificationRequest', () => {
    it('should create a completed rectification request', async () => {
      const req = await gdpr.handleRectificationRequest('user-1', { name: 'Jane Doe' });
      expect(req.type).toBe('rectification');
      expect(req.status).toBe('completed');
      expect(req.subjectId).toBe('user-1');
    });

    it('should record the rectification request', async () => {
      await gdpr.handleRectificationRequest('user-1', { email: 'new@email.com' });
      const requests = gdpr.getRequests({ type: 'rectification' });
      expect(requests).toHaveLength(1);
    });
  });

  // ── Consent Management ───────────────────────────────────

  describe('recordConsent', () => {
    it('should record consent and return the record', () => {
      const record = gdpr.recordConsent('user-1', 'analytics', true);
      expect(record.userId).toBe('user-1');
      expect(record.purpose).toBe('analytics');
      expect(record.granted).toBe(true);
      expect(record.expiresAt).not.toBeNull();
      expect(record.id).toBeTruthy();
    });

    it('should set expiresAt to null when consent is denied', () => {
      const record = gdpr.recordConsent('user-1', 'analytics', false);
      expect(record.granted).toBe(false);
      expect(record.expiresAt).toBeNull();
    });

    it('should replace existing consent for the same purpose', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      gdpr.recordConsent('user-1', 'analytics', false);
      const consents = gdpr.getConsents('user-1');
      expect(consents).toHaveLength(1);
      expect(consents[0]!.granted).toBe(false);
    });

    it('should allow multiple purposes for same user', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      gdpr.recordConsent('user-1', 'marketing', true);
      gdpr.recordConsent('user-1', 'personalization', false);
      const consents = gdpr.getConsents('user-1');
      expect(consents).toHaveLength(3);
    });
  });

  describe('withdrawConsent', () => {
    it('should set consent to false', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      const withdrawn = gdpr.withdrawConsent('user-1', 'analytics');
      expect(withdrawn.granted).toBe(false);
      expect(gdpr.hasConsent('user-1', 'analytics')).toBe(false);
    });
  });

  describe('hasConsent', () => {
    it('should return false for unknown user', () => {
      expect(gdpr.hasConsent('nobody', 'analytics')).toBe(false);
    });

    it('should return false for unknown purpose', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      expect(gdpr.hasConsent('user-1', 'marketing')).toBe(false);
    });

    it('should return false for expired consent', () => {
      // A negative expiration means the consent is already expired at creation time
      const expired = createGDPRManager({ consentExpirationMs: -1 });
      expired.recordConsent('user-1', 'analytics', true);
      expect(expired.hasConsent('user-1', 'analytics')).toBe(false);
      expired.dispose();
    });

    it('should return true for valid consent', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      expect(gdpr.hasConsent('user-1', 'analytics')).toBe(true);
    });
  });

  describe('getConsents', () => {
    it('should return empty array for unknown user', () => {
      expect(gdpr.getConsents('nobody')).toEqual([]);
    });

    it('should return a copy (not internal reference)', () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      const consents = gdpr.getConsents('user-1');
      consents.push({} as any);
      expect(gdpr.getConsents('user-1')).toHaveLength(1);
    });
  });

  // ── Request Filtering ────────────────────────────────────

  describe('getRequests', () => {
    it('should filter by status', async () => {
      await gdpr.handleAccessRequest('user-1');
      const completed = gdpr.getRequests({ status: 'completed' });
      expect(completed).toHaveLength(1);
      const pending = gdpr.getRequests({ status: 'pending' });
      expect(pending).toHaveLength(0);
    });

    it('should filter by type', async () => {
      await gdpr.handleAccessRequest('user-1');
      await gdpr.handleErasureRequest('user-2');
      const access = gdpr.getRequests({ type: 'access' });
      expect(access).toHaveLength(1);
      const erasure = gdpr.getRequests({ type: 'erasure' });
      expect(erasure).toHaveLength(1);
    });

    it('should filter by both status and type', async () => {
      await gdpr.handleAccessRequest('user-1');
      await gdpr.handleErasureRequest('user-2');
      const results = gdpr.getRequests({ status: 'completed', type: 'erasure' });
      expect(results).toHaveLength(1);
      expect(results[0]!.subjectId).toBe('user-2');
    });

    it('should return all when no filters', async () => {
      await gdpr.handleAccessRequest('user-1');
      await gdpr.handleErasureRequest('user-2');
      await gdpr.handleRectificationRequest('user-3', {});
      expect(gdpr.getRequests()).toHaveLength(3);
    });
  });

  // ── Compliance Check ─────────────────────────────────────

  describe('runComplianceCheck', () => {
    it('should pass with default config', () => {
      const result = gdpr.runComplianceCheck();
      expect(result.framework).toBe('gdpr');
      expect(result.passed).toBe(true);
      expect(result.checks.length).toBe(5);
    });

    it('should fail when consent disabled', () => {
      const m = createGDPRManager({ consentEnabled: false });
      const result = m.runComplianceCheck();
      expect(result.passed).toBe(false);
      const check = result.checks.find((c) => c.name === 'consent-management');
      expect(check?.status).toBe('fail');
      m.dispose();
    });

    it('should fail when breach window exceeds 72 hours', () => {
      const m = createGDPRManager({ breachNotificationWindowHours: 96 });
      const result = m.runComplianceCheck();
      expect(result.passed).toBe(false);
      const check = result.checks.find((c) => c.name === 'breach-notification');
      expect(check?.status).toBe('fail');
      m.dispose();
    });

    it('should warn when data classification is public', () => {
      const m = createGDPRManager({ dataClassification: 'public' });
      const result = m.runComplianceCheck();
      const check = result.checks.find((c) => c.name === 'data-classification');
      expect(check?.status).toBe('warn');
      m.dispose();
    });

    it('should warn when no retention policies configured', () => {
      const result = gdpr.runComplianceCheck();
      const check = result.checks.find((c) => c.name === 'retention-policy');
      expect(check?.status).toBe('warn');
    });

    it('should pass retention check when policies exist', () => {
      const m = createGDPRManager({
        retentionPolicies: [{ collection: 'logs', maxAge: 1000, action: 'delete' }],
      });
      const result = m.runComplianceCheck();
      const check = result.checks.find((c) => c.name === 'retention-policy');
      expect(check?.status).toBe('pass');
      m.dispose();
    });

    it('should warn when PII detection disabled', () => {
      const m = createGDPRManager({ piiDetectionEnabled: false });
      const result = m.runComplianceCheck();
      const check = result.checks.find((c) => c.name === 'pii-detection');
      expect(check?.status).toBe('warn');
      m.dispose();
    });
  });

  // ── PII Detection ────────────────────────────────────────

  describe('detectPII', () => {
    it('should detect email fields', () => {
      const results = gdpr.detectPII({ email: 'john@example.com' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('email');
      expect(results[0]!.confidence).toBe(0.95);
    });

    it('should detect phone fields', () => {
      const results = gdpr.detectPII({ phone: '+1 555-123-4567' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('phone');
    });

    it('should detect name fields', () => {
      const results = gdpr.detectPII({ firstName: 'John', lastName: 'Doe' });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.type === 'name')).toBe(true);
    });

    it('should detect SSN fields', () => {
      const results = gdpr.detectPII({ ssn: '123-45-6789' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('ssn');
    });

    it('should detect IP address fields', () => {
      const results = gdpr.detectPII({ ipAddr: '192.168.1.1' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('ip_address');
    });

    it('should detect address fields', () => {
      const results = gdpr.detectPII({ address: '123 Main St' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('address');
    });

    it('should detect date of birth fields', () => {
      const results = gdpr.detectPII({ dateOfBirth: '1990-01-15' });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe('date_of_birth');
    });

    it('should skip non-string values', () => {
      const results = gdpr.detectPII({ email: 42, phone: true, age: 30 });
      expect(results).toHaveLength(0);
    });

    it('should detect multiple PII fields', () => {
      const results = gdpr.detectPII({
        email: 'test@example.com',
        phone: '+44 20 7946 0958',
        name: 'Jane Doe',
        age: 30,
      });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for empty document', () => {
      expect(gdpr.detectPII({})).toEqual([]);
    });

    it('should return empty array for document with no PII', () => {
      const results = gdpr.detectPII({ color: 'blue', count: 'five' });
      expect(results).toHaveLength(0);
    });
  });

  // ── Dispose ──────────────────────────────────────────────

  describe('dispose', () => {
    it('should clear all consents and requests', async () => {
      gdpr.recordConsent('user-1', 'analytics', true);
      await gdpr.handleAccessRequest('user-1');

      gdpr.dispose();

      expect(gdpr.getConsents('user-1')).toHaveLength(0);
      expect(gdpr.getRequests()).toHaveLength(0);
    });
  });
});
