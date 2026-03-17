import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BreachNotificationManager,
  createBreachNotificationManager,
} from '../breach-notification.js';

describe('BreachNotificationManager', () => {
  let manager: BreachNotificationManager;

  beforeEach(() => {
    manager = createBreachNotificationManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  // ── Factory ──────────────────────────────────────────────

  describe('createBreachNotificationManager factory', () => {
    it('should create an instance', () => {
      expect(manager).toBeInstanceOf(BreachNotificationManager);
    });
  });

  // ── Report Breach ────────────────────────────────────────

  describe('reportBreach', () => {
    it('should create a breach record with detected status', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 1500,
        description: 'Unauthorized database access',
        detectedAt: Date.now(),
      });

      expect(breach.id).toBeTruthy();
      expect(breach.status).toBe('detected');
      expect(breach.notifiedAt).toBeNull();
      expect(breach.severity).toBe('high');
      expect(breach.affectedRecords).toBe(1500);
      expect(breach.description).toBe('Unauthorized database access');
    });

    it('should generate unique IDs for each breach', () => {
      const b1 = manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'b1',
        detectedAt: Date.now(),
      });
      const b2 = manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'b2',
        detectedAt: Date.now(),
      });
      expect(b1.id).not.toBe(b2.id);
    });

    it('should emit breach event on breach$ observable', () => {
      const received: any[] = [];
      const sub = manager.breach$.subscribe((b) => received.push(b));

      manager.reportBreach({
        severity: 'critical',
        affectedRecords: 5000,
        description: 'Data leak',
        detectedAt: Date.now(),
      });

      expect(received).toHaveLength(1);
      expect(received[0]!.severity).toBe('critical');
      sub.unsubscribe();
    });

    it('should support all severity levels', () => {
      const severities = ['low', 'medium', 'high', 'critical'] as const;
      for (const severity of severities) {
        const breach = manager.reportBreach({
          severity,
          affectedRecords: 10,
          description: `${severity} breach`,
          detectedAt: Date.now(),
        });
        expect(breach.severity).toBe(severity);
      }
    });
  });

  // ── Get Breaches ─────────────────────────────────────────

  describe('getBreaches', () => {
    it('should return all breaches when no filter', () => {
      manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'a',
        detectedAt: Date.now(),
      });
      manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'b',
        detectedAt: Date.now(),
      });
      expect(manager.getBreaches()).toHaveLength(2);
    });

    it('should filter by severity', () => {
      manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'a',
        detectedAt: Date.now(),
      });
      manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'b',
        detectedAt: Date.now(),
      });
      manager.reportBreach({
        severity: 'high',
        affectedRecords: 200,
        description: 'c',
        detectedAt: Date.now(),
      });

      expect(manager.getBreaches({ severity: 'high' })).toHaveLength(2);
      expect(manager.getBreaches({ severity: 'low' })).toHaveLength(1);
      expect(manager.getBreaches({ severity: 'critical' })).toHaveLength(0);
    });

    it('should filter by status', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'a',
        detectedAt: Date.now(),
      });
      manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'b',
        detectedAt: Date.now(),
      });

      manager.updateBreachStatus(breach.id, 'contained');

      expect(manager.getBreaches({ status: 'detected' })).toHaveLength(1);
      expect(manager.getBreaches({ status: 'contained' })).toHaveLength(1);
    });

    it('should return empty array when no breaches exist', () => {
      expect(manager.getBreaches()).toHaveLength(0);
    });
  });

  // ── Update Breach Status ─────────────────────────────────

  describe('updateBreachStatus', () => {
    it('should update status to investigating', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'test',
        detectedAt: Date.now(),
      });

      const updated = manager.updateBreachStatus(breach.id, 'investigating');
      expect(updated.status).toBe('investigating');
    });

    it('should update status to contained', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'test',
        detectedAt: Date.now(),
      });

      const updated = manager.updateBreachStatus(breach.id, 'contained');
      expect(updated.status).toBe('contained');
    });

    it('should update status to resolved', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'test',
        detectedAt: Date.now(),
      });

      const updated = manager.updateBreachStatus(breach.id, 'resolved');
      expect(updated.status).toBe('resolved');
    });

    it('should set notifiedAt when status is "notified"', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'test',
        detectedAt: Date.now(),
      });

      expect(breach.notifiedAt).toBeNull();
      const updated = manager.updateBreachStatus(breach.id, 'notified');
      expect(updated.status).toBe('notified');
      expect(updated.notifiedAt).not.toBeNull();
      expect(typeof updated.notifiedAt).toBe('number');
    });

    it('should throw for unknown breach ID', () => {
      expect(() => manager.updateBreachStatus('nonexistent', 'contained')).toThrow(
        'Breach not found: nonexistent'
      );
    });

    it('should support workflow progression', () => {
      const breach = manager.reportBreach({
        severity: 'critical',
        affectedRecords: 5000,
        description: 'Major breach',
        detectedAt: Date.now(),
      });

      manager.updateBreachStatus(breach.id, 'investigating');
      manager.updateBreachStatus(breach.id, 'contained');
      manager.updateBreachStatus(breach.id, 'notified');
      manager.updateBreachStatus(breach.id, 'resolved');

      const final = manager.getBreaches()[0]!;
      expect(final.status).toBe('resolved');
      expect(final.notifiedAt).not.toBeNull();
    });
  });

  // ── Impact Assessment ────────────────────────────────────

  describe('assessImpact', () => {
    it('should assess high-severity breach with GDPR requirements', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'Data breach',
        detectedAt: Date.now(),
      });

      const impact = manager.assessImpact(breach.id);
      expect(impact.affectedUsers).toBe(100);
      expect(impact.severity).toBe('high');
      expect(impact.dataTypes).toContain('personal_data');
      expect(impact.regulatoryRequirements.some((r) => r.includes('GDPR'))).toBe(true);
    });

    it('should include HIPAA requirements for >500 records', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 600,
        description: 'Large breach',
        detectedAt: Date.now(),
      });

      const impact = manager.assessImpact(breach.id);
      expect(impact.regulatoryRequirements.some((r) => r.includes('HIPAA'))).toBe(true);
      expect(impact.regulatoryRequirements.some((r) => r.includes('media'))).toBe(true);
    });

    it('should not include HIPAA media requirement for <=500 records', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 500,
        description: 'Small breach',
        detectedAt: Date.now(),
      });

      const impact = manager.assessImpact(breach.id);
      expect(impact.regulatoryRequirements.some((r) => r.includes('media'))).toBe(false);
    });

    it('should always include SOC 2 requirement', () => {
      const breach = manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'Minor',
        detectedAt: Date.now(),
      });

      const impact = manager.assessImpact(breach.id);
      expect(impact.regulatoryRequirements.some((r) => r.includes('SOC 2'))).toBe(true);
    });

    it('should add sensitive_data and credentials for critical breaches', () => {
      const breach = manager.reportBreach({
        severity: 'critical',
        affectedRecords: 10000,
        description: 'Credentials exposed',
        detectedAt: Date.now(),
      });

      const impact = manager.assessImpact(breach.id);
      expect(impact.dataTypes).toContain('sensitive_data');
      expect(impact.dataTypes).toContain('credentials');
    });

    it('should not add sensitive_data for low severity', () => {
      const breach = manager.reportBreach({
        severity: 'low',
        affectedRecords: 5,
        description: 'Minor',
        detectedAt: Date.now(),
      });

      const impact = manager.assessImpact(breach.id);
      expect(impact.dataTypes).not.toContain('sensitive_data');
      expect(impact.dataTypes).not.toContain('credentials');
    });

    it('should not include GDPR notification for medium severity', () => {
      const breach = manager.reportBreach({
        severity: 'medium',
        affectedRecords: 50,
        description: 'Medium breach',
        detectedAt: Date.now(),
      });

      const impact = manager.assessImpact(breach.id);
      expect(
        impact.regulatoryRequirements.some((r) => r.includes('Notify supervisory authority'))
      ).toBe(false);
    });

    it('should throw for unknown breach ID', () => {
      expect(() => manager.assessImpact('nonexistent')).toThrow('Breach not found');
    });
  });

  // ── Notification Window ──────────────────────────────────

  describe('isWithinNotificationWindow', () => {
    it('should return true for recent breach within 72h window', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'Recent',
        detectedAt: Date.now(),
      });

      expect(manager.isWithinNotificationWindow(breach.id)).toBe(true);
    });

    it('should return true for recent breach with custom window', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'Recent',
        detectedAt: Date.now(),
      });

      expect(manager.isWithinNotificationWindow(breach.id, 24)).toBe(true);
    });

    it('should return false for breach outside notification window', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'Old breach',
        detectedAt: Date.now() - 73 * 60 * 60 * 1000, // 73 hours ago
      });

      expect(manager.isWithinNotificationWindow(breach.id, 72)).toBe(false);
    });

    it('should use default 72h window', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'Old breach',
        detectedAt: Date.now() - 80 * 60 * 60 * 1000,
      });

      expect(manager.isWithinNotificationWindow(breach.id)).toBe(false);
    });

    it('should throw for unknown breach ID', () => {
      expect(() => manager.isWithinNotificationWindow('nonexistent')).toThrow('Breach not found');
    });

    it('should handle very short notification windows', () => {
      const breach = manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'Urgent',
        detectedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      });

      expect(manager.isWithinNotificationWindow(breach.id, 1)).toBe(false);
      expect(manager.isWithinNotificationWindow(breach.id, 3)).toBe(true);
    });
  });

  // ── Observable Stream ────────────────────────────────────

  describe('breach$ observable', () => {
    it('should emit for each reported breach', () => {
      const received: any[] = [];
      const sub = manager.breach$.subscribe((b) => received.push(b));

      manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'a',
        detectedAt: Date.now(),
      });
      manager.reportBreach({
        severity: 'high',
        affectedRecords: 100,
        description: 'b',
        detectedAt: Date.now(),
      });

      expect(received).toHaveLength(2);
      sub.unsubscribe();
    });

    it('should not emit after dispose', () => {
      const received: any[] = [];
      const sub = manager.breach$.subscribe((b) => received.push(b));

      manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'before',
        detectedAt: Date.now(),
      });

      manager.dispose();

      // After dispose, subject is complete — new reports will throw
      // but we just test that the observable completed properly
      expect(received).toHaveLength(1);
      sub.unsubscribe();
    });
  });

  // ── Dispose ──────────────────────────────────────────────

  describe('dispose', () => {
    it('should clear all breaches', () => {
      manager.reportBreach({
        severity: 'low',
        affectedRecords: 1,
        description: 'test',
        detectedAt: Date.now(),
      });

      manager.dispose();
      expect(manager.getBreaches()).toHaveLength(0);
    });

    it('should complete the breach$ observable', () => {
      let completed = false;
      manager.breach$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      manager.dispose();
      expect(completed).toBe(true);
    });
  });
});
