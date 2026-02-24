import { describe, expect, it } from 'vitest';
import { ComplianceEngine } from '../compliance-engine.js';

describe('ComplianceEngine', () => {
  const testData = () => ({
    users: [
      {
        _id: 'u1',
        userId: 'user-1',
        name: 'Alice',
        email: 'alice@test.com',
        createdAt: Date.now(),
      },
      { _id: 'u2', userId: 'user-2', name: 'Bob', email: 'bob@test.com', createdAt: Date.now() },
    ],
    orders: [
      { _id: 'o1', userId: 'user-1', amount: 100, createdAt: Date.now() },
      { _id: 'o2', userId: 'user-2', amount: 200, createdAt: Date.now() },
      { _id: 'o3', userId: 'user-1', amount: 50, createdAt: Date.now() },
    ],
  });

  describe('GDPR Export', () => {
    it('should export all user data', () => {
      const engine = new ComplianceEngine();
      const data = testData();
      const result = engine.exportUserData('user-1', data);

      expect(result.userId).toBe('user-1');
      expect(result.totalDocuments).toBe(3); // 1 user + 2 orders
      expect(result.collections.users).toHaveLength(1);
      expect(result.collections.orders).toHaveLength(2);
    });

    it('should record export in audit log', () => {
      const engine = new ComplianceEngine();
      engine.exportUserData('user-1', testData());
      const log = engine.getAuditLog();
      expect(log.some((e) => e.action === 'export')).toBe(true);
    });
  });

  describe('GDPR Deletion', () => {
    it('should delete all user data', () => {
      const engine = new ComplianceEngine();
      const data = testData();
      const result = engine.deleteUserData('user-1', data);

      expect(result.documentsDeleted).toBe(3);
      expect(result.collectionsAffected).toContain('users');
      expect(result.collectionsAffected).toContain('orders');
      expect(data.users).toHaveLength(1); // only user-2 remains
      expect(data.orders).toHaveLength(1); // only user-2's order
    });
  });

  describe('Consent Management', () => {
    it('should record and check consent', () => {
      const engine = new ComplianceEngine();
      engine.recordConsent('user-1', { analytics: true, marketing: false });

      expect(engine.hasConsent('user-1', 'analytics')).toBe(true);
      expect(engine.hasConsent('user-1', 'marketing')).toBe(false);
      expect(engine.hasConsent('user-1', 'unknown')).toBe(false);
    });

    it('should return null for unknown users', () => {
      const engine = new ComplianceEngine();
      expect(engine.getUserConsents('nonexistent')).toBeNull();
    });
  });

  describe('Audit Trail', () => {
    it('should maintain hash chain integrity', () => {
      const engine = new ComplianceEngine();
      engine.recordAudit('read', 'user-1', 'users', 'u1', 'Read user profile');
      engine.recordAudit('write', 'user-1', 'orders', 'o1', 'Created order');
      engine.recordAudit('delete', 'admin', 'users', 'u2', 'Deleted user');

      const verification = engine.verifyAuditChain();
      expect(verification.valid).toBe(true);
    });

    it('should filter audit log by userId', () => {
      const engine = new ComplianceEngine();
      engine.recordAudit('read', 'user-1', 'users', 'u1', 'Read');
      engine.recordAudit('write', 'user-2', 'orders', 'o1', 'Write');
      engine.recordAudit('read', 'user-1', 'orders', 'o2', 'Read');

      const user1Log = engine.getAuditLog({ userId: 'user-1' });
      expect(user1Log).toHaveLength(2);
    });

    it('should not record when audit trail disabled', () => {
      const engine = new ComplianceEngine({ auditTrail: false });
      engine.recordAudit('read', 'user-1', 'users', 'u1', 'Read');
      expect(engine.getAuditLog()).toHaveLength(0);
    });
  });

  describe('Data Retention', () => {
    it('should delete expired documents', () => {
      const engine = new ComplianceEngine({
        retentionPolicies: [{ collection: 'logs', maxAgeDays: 30, action: 'delete' }],
      });

      const oldTimestamp = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days ago
      const data = {
        logs: [
          { _id: '1', message: 'old', createdAt: oldTimestamp },
          { _id: '2', message: 'new', createdAt: Date.now() },
        ],
      };

      const results = engine.applyRetention(data);
      expect(results[0]!.documentsExpired).toBe(1);
      expect(data.logs).toHaveLength(1);
      expect(data.logs[0]!.message).toBe('new');
    });

    it('should anonymize expired documents', () => {
      const engine = new ComplianceEngine({
        retentionPolicies: [{ collection: 'users', maxAgeDays: 1, action: 'anonymize' }],
      });

      const old = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const data = {
        users: [
          { _id: '1', name: 'Alice', email: 'alice@test.com', userId: 'u1', createdAt: old },
          { _id: '2', name: 'Bob', email: 'bob@test.com', userId: 'u2', createdAt: Date.now() },
        ],
      };

      engine.applyRetention(data);
      expect(data.users[0]!.name).toBe('Anonymized User');
      expect(data.users[0]!.email).toBe('anonymized@example.com');
      expect(data.users[1]!.name).toBe('Bob'); // not expired
    });
  });

  describe('Compliance Report', () => {
    it('should generate a compliance report', () => {
      const engine = new ComplianceEngine({
        retentionPolicies: [{ collection: 'logs', maxAgeDays: 30, action: 'delete' }],
      });
      engine.recordAudit('read', 'u1', 'users', 'u1', 'Test');

      const report = engine.getReport();
      expect(report.gdprEnabled).toBe(true);
      expect(report.auditTrailEnabled).toBe(true);
      expect(report.auditEntries).toBe(1);
      expect(report.retentionPolicies).toBe(1);
      expect(report.chainValid).toBe(true);
    });
  });
});
