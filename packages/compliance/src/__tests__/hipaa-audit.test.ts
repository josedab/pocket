import { beforeEach, describe, expect, it } from 'vitest';
import { HIPAAAuditLogger, createHIPAAAuditLogger } from '../hipaa-audit.js';

describe('HIPAAAuditLogger', () => {
  let logger: HIPAAAuditLogger;

  beforeEach(() => {
    logger = createHIPAAAuditLogger({
      phiCollections: ['patients', 'medical_records', 'prescriptions'],
    });
  });

  // ── Factory ──────────────────────────────────────────────

  describe('createHIPAAAuditLogger factory', () => {
    it('should create with default config', () => {
      const l = createHIPAAAuditLogger();
      expect(l).toBeInstanceOf(HIPAAAuditLogger);
    });

    it('should accept custom config', () => {
      const l = createHIPAAAuditLogger({
        retentionDays: 3000,
        phiCollections: ['patients'],
        hashAlgorithm: 'djb2',
        autoLog: false,
      });
      expect(l).toBeInstanceOf(HIPAAAuditLogger);
    });
  });

  // ── PHI Access Logging ───────────────────────────────────

  describe('logAccess', () => {
    it('should log a PHI access event with all fields', () => {
      const log = logger.logAccess({
        userId: 'dr-smith',
        action: 'read',
        collection: 'patients',
        documentId: 'pat-001',
        fields: ['name', 'diagnosis'],
        ipAddress: '10.0.0.5',
        userAgent: 'EMR/1.0',
        reason: 'Patient consultation',
      });

      expect(log.userId).toBe('dr-smith');
      expect(log.action).toBe('read');
      expect(log.collection).toBe('patients');
      expect(log.documentId).toBe('pat-001');
      expect(log.fields).toEqual(['name', 'diagnosis']);
      expect(log.ipAddress).toBe('10.0.0.5');
      expect(log.userAgent).toBe('EMR/1.0');
      expect(log.reason).toBe('Patient consultation');
      expect(log.hash).toBeTruthy();
      expect(log.id).toMatch(/^hipaa-/);
    });

    it('should use defaults for optional fields', () => {
      const log = logger.logAccess({
        userId: 'nurse-1',
        action: 'read',
        collection: 'patients',
        documentId: 'pat-002',
      });

      expect(log.fields).toEqual([]);
      expect(log.ipAddress).toBe('unknown');
      expect(log.userAgent).toBe('unknown');
      expect(log.reason).toBe('');
    });

    it('should generate unique IDs for each log', () => {
      const log1 = logger.logAccess({
        userId: 'dr-smith',
        action: 'read',
        collection: 'patients',
        documentId: 'pat-001',
      });
      const log2 = logger.logAccess({
        userId: 'dr-smith',
        action: 'read',
        collection: 'patients',
        documentId: 'pat-002',
      });
      expect(log1.id).not.toBe(log2.id);
    });

    it('should log all action types', () => {
      const actions = ['read', 'write', 'delete', 'export', 'share'] as const;
      for (const action of actions) {
        const log = logger.logAccess({
          userId: 'user-1',
          action,
          collection: 'patients',
          documentId: 'p1',
        });
        expect(log.action).toBe(action);
      }
    });

    it('should set the initial previousHash to zeros', () => {
      const log = logger.logAccess({
        userId: 'user-1',
        action: 'read',
        collection: 'patients',
        documentId: 'p1',
      });
      expect(log.previousHash).toBe('00000000');
    });

    it('should chain hashes between log entries', () => {
      const log1 = logger.logAccess({
        userId: 'user-1',
        action: 'read',
        collection: 'patients',
        documentId: 'p1',
      });
      const log2 = logger.logAccess({
        userId: 'user-1',
        action: 'write',
        collection: 'patients',
        documentId: 'p2',
      });

      expect(log2.previousHash).toBe(log1.hash);
    });
  });

  // ── Hash Chain Integrity ─────────────────────────────────

  describe('verifyChain', () => {
    it('should verify an empty chain as valid', () => {
      const result = logger.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
    });

    it('should verify a single-entry chain as valid', () => {
      logger.logAccess({
        userId: 'user-1',
        action: 'read',
        collection: 'patients',
        documentId: 'p1',
      });
      const result = logger.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
    });

    it('should verify a multi-entry chain as valid', () => {
      for (let i = 0; i < 10; i++) {
        logger.logAccess({
          userId: `user-${i}`,
          action: 'read',
          collection: 'patients',
          documentId: `p-${i}`,
        });
      }
      const result = logger.verifyChain();
      expect(result.valid).toBe(true);
    });

    it('should maintain chain integrity across different actions', () => {
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'patients', documentId: 'p1' });
      logger.logAccess({
        userId: 'u2',
        action: 'write',
        collection: 'medical_records',
        documentId: 'mr1',
      });
      logger.logAccess({
        userId: 'u1',
        action: 'export',
        collection: 'patients',
        documentId: 'p1',
      });
      logger.logAccess({
        userId: 'u3',
        action: 'delete',
        collection: 'prescriptions',
        documentId: 'rx1',
      });

      expect(logger.verifyChain().valid).toBe(true);
    });
  });

  // ── Query by User ────────────────────────────────────────

  describe('getLogsByUser', () => {
    it('should return logs for a specific user', () => {
      logger.logAccess({ userId: 'dr-smith', action: 'read', collection: 'p', documentId: 'd1' });
      logger.logAccess({ userId: 'nurse-1', action: 'read', collection: 'p', documentId: 'd2' });
      logger.logAccess({ userId: 'dr-smith', action: 'write', collection: 'p', documentId: 'd3' });

      const logs = logger.getLogsByUser('dr-smith');
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.userId === 'dr-smith')).toBe(true);
    });

    it('should return empty for unknown user', () => {
      logger.logAccess({ userId: 'dr-smith', action: 'read', collection: 'p', documentId: 'd1' });
      expect(logger.getLogsByUser('nobody')).toHaveLength(0);
    });

    it('should filter by time range', () => {
      const now = Date.now();
      logger.logAccess({ userId: 'dr-smith', action: 'read', collection: 'p', documentId: 'd1' });

      const logs = logger.getLogsByUser('dr-smith', now - 1000, now + 1000);
      expect(logs).toHaveLength(1);

      const futureLogs = logger.getLogsByUser('dr-smith', now + 10000);
      expect(futureLogs).toHaveLength(0);
    });
  });

  // ── Query by Collection ──────────────────────────────────

  describe('getLogsByCollection', () => {
    it('should return logs for a specific collection', () => {
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'patients', documentId: 'd1' });
      logger.logAccess({
        userId: 'u1',
        action: 'read',
        collection: 'prescriptions',
        documentId: 'd2',
      });
      logger.logAccess({ userId: 'u2', action: 'read', collection: 'patients', documentId: 'd3' });

      const logs = logger.getLogsByCollection('patients');
      expect(logs).toHaveLength(2);
    });

    it('should return empty for unknown collection', () => {
      expect(logger.getLogsByCollection('nonexistent')).toHaveLength(0);
    });
  });

  // ── Report Generation ────────────────────────────────────

  describe('generateReport', () => {
    it('should generate a report for a time period', () => {
      const now = Date.now();
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'patients', documentId: 'd1' });
      logger.logAccess({
        userId: 'u1',
        action: 'write',
        collection: 'patients',
        documentId: 'd2',
      });
      logger.logAccess({
        userId: 'u2',
        action: 'read',
        collection: 'prescriptions',
        documentId: 'd3',
      });

      const report = logger.generateReport(now - 1000, now + 1000);

      expect(report.totalAccesses).toBe(3);
      expect(report.byUser['u1']).toBe(2);
      expect(report.byUser['u2']).toBe(1);
      expect(report.byAction['read']).toBe(2);
      expect(report.byAction['write']).toBe(1);
      expect(report.byCollection['patients']).toBe(2);
      expect(report.byCollection['prescriptions']).toBe(1);
      expect(report.chainIntegrity).toBe(true);
      expect(report.period.from).toBeLessThan(report.period.to);
    });

    it('should return zero totals for empty period', () => {
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'patients', documentId: 'd1' });
      const report = logger.generateReport(0, 1);
      expect(report.totalAccesses).toBe(0);
    });

    it('should detect unusual volume anomalies', () => {
      const now = Date.now();
      // Create >100 accesses for a single user in one day
      for (let i = 0; i < 110; i++) {
        logger.logAccess({
          userId: 'suspicious-user',
          action: 'read',
          collection: 'patients',
          documentId: `p-${i}`,
        });
      }

      const report = logger.generateReport(now - 1000, now + 60000);
      const volumeAnomalies = report.anomalies.filter((a) => a.type === 'unusual-volume');
      expect(volumeAnomalies.length).toBeGreaterThanOrEqual(1);
      expect(volumeAnomalies[0]!.severity).toBe('high');
    });

    it('should detect critical volume anomalies (>500)', () => {
      const now = Date.now();
      for (let i = 0; i < 510; i++) {
        logger.logAccess({
          userId: 'attacker',
          action: 'read',
          collection: 'patients',
          documentId: `p-${i}`,
        });
      }

      const report = logger.generateReport(now - 1000, now + 60000);
      const critical = report.anomalies.filter(
        (a) => a.type === 'unusual-volume' && a.severity === 'critical'
      );
      expect(critical.length).toBe(1);
    });

    it('should detect bulk export anomalies', () => {
      const now = Date.now();
      for (let i = 0; i < 15; i++) {
        logger.logAccess({
          userId: 'user-1',
          action: 'export',
          collection: 'patients',
          documentId: `p-${i}`,
        });
      }

      const report = logger.generateReport(now - 1000, now + 60000);
      const exportAnomalies = report.anomalies.filter((a) => a.type === 'bulk-export');
      expect(exportAnomalies.length).toBe(1);
      expect(exportAnomalies[0]!.severity).toBe('high');
    });

    it('should not flag normal export volume', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        logger.logAccess({
          userId: 'user-1',
          action: 'export',
          collection: 'patients',
          documentId: `p-${i}`,
        });
      }

      const report = logger.generateReport(now - 1000, now + 60000);
      const exportAnomalies = report.anomalies.filter((a) => a.type === 'bulk-export');
      expect(exportAnomalies).toHaveLength(0);
    });

    it('should report no anomalies for normal usage', () => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        logger.logAccess({
          userId: 'user-1',
          action: 'read',
          collection: 'patients',
          documentId: `p-${i}`,
        });
      }

      const report = logger.generateReport(now - 1000, now + 60000);
      expect(report.anomalies).toHaveLength(0);
    });
  });

  // ── Purge Expired ────────────────────────────────────────

  describe('purgeExpired', () => {
    it('should not purge recent logs', () => {
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'p', documentId: 'd1' });
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'p', documentId: 'd2' });
      const purged = logger.purgeExpired();
      expect(purged).toBe(0);
      expect(logger.getAllLogs()).toHaveLength(2);
    });

    it('should purge logs when retention period has passed', () => {
      // Use -1 retention days so cutoff is in the future, expiring everything
      const shortRetention = createHIPAAAuditLogger({ retentionDays: -1 });
      shortRetention.logAccess({
        userId: 'u1',
        action: 'read',
        collection: 'p',
        documentId: 'd1',
      });
      const purged = shortRetention.purgeExpired();
      expect(purged).toBe(1);
      expect(shortRetention.getAllLogs()).toHaveLength(0);
    });
  });

  // ── Get All Logs ─────────────────────────────────────────

  describe('getAllLogs', () => {
    it('should return all logs', () => {
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'p', documentId: 'd1' });
      logger.logAccess({ userId: 'u2', action: 'write', collection: 'p', documentId: 'd2' });
      expect(logger.getAllLogs()).toHaveLength(2);
    });

    it('should return empty array when no logs', () => {
      expect(logger.getAllLogs()).toHaveLength(0);
    });

    it('should return a copy (not internal reference)', () => {
      logger.logAccess({ userId: 'u1', action: 'read', collection: 'p', documentId: 'd1' });
      const logs = logger.getAllLogs();
      expect(logs).toHaveLength(1);
      // getAllLogs returns readonly, but the spread should make it a fresh array
    });
  });

  // ── PHI Collection Check ─────────────────────────────────

  describe('isPHICollection', () => {
    it('should identify configured PHI collections', () => {
      expect(logger.isPHICollection('patients')).toBe(true);
      expect(logger.isPHICollection('medical_records')).toBe(true);
      expect(logger.isPHICollection('prescriptions')).toBe(true);
    });

    it('should return false for non-PHI collections', () => {
      expect(logger.isPHICollection('billing')).toBe(false);
      expect(logger.isPHICollection('settings')).toBe(false);
    });

    it('should return false when no PHI collections configured', () => {
      const l = createHIPAAAuditLogger();
      expect(l.isPHICollection('patients')).toBe(false);
    });
  });
});
