import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RetentionEngine, createRetentionEngine } from '../retention-engine.js';

describe('RetentionEngine', () => {
  let engine: RetentionEngine;

  beforeEach(() => {
    engine = createRetentionEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  // ── Factory ──────────────────────────────────────────────

  describe('createRetentionEngine factory', () => {
    it('should create with no policies', () => {
      expect(engine).toBeInstanceOf(RetentionEngine);
      expect(engine.getPolicies()).toHaveLength(0);
    });

    it('should create with initial policies', () => {
      const custom = createRetentionEngine([
        { collection: 'logs', maxAge: 30 * 24 * 60 * 60 * 1000, action: 'delete' },
        { collection: 'audit', maxAge: 365 * 24 * 60 * 60 * 1000, action: 'archive' },
      ]);
      expect(custom.getPolicies()).toHaveLength(2);
      custom.dispose();
    });
  });

  // ── Policy Management ────────────────────────────────────

  describe('addPolicy', () => {
    it('should add a new retention policy', () => {
      engine.addPolicy({ collection: 'sessions', maxAge: 1000, action: 'delete' });
      expect(engine.getPolicies()).toHaveLength(1);
      expect(engine.getPolicies()[0]!.collection).toBe('sessions');
    });

    it('should overwrite policy for same collection', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      engine.addPolicy({ collection: 'logs', maxAge: 5000, action: 'archive' });
      const policies = engine.getPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0]!.maxAge).toBe(5000);
      expect(policies[0]!.action).toBe('archive');
    });

    it('should support all action types', () => {
      engine.addPolicy({ collection: 'a', maxAge: 1000, action: 'delete' });
      engine.addPolicy({ collection: 'b', maxAge: 1000, action: 'archive' });
      engine.addPolicy({ collection: 'c', maxAge: 1000, action: 'anonymize' });
      expect(engine.getPolicies()).toHaveLength(3);
    });
  });

  describe('removePolicy', () => {
    it('should remove an existing policy', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      engine.removePolicy('logs');
      expect(engine.getPolicies()).toHaveLength(0);
    });

    it('should not throw when removing nonexistent policy', () => {
      expect(() => engine.removePolicy('nonexistent')).not.toThrow();
    });

    it('should only remove the specified policy', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      engine.addPolicy({ collection: 'audit', maxAge: 2000, action: 'archive' });
      engine.removePolicy('logs');
      expect(engine.getPolicies()).toHaveLength(1);
      expect(engine.getPolicies()[0]!.collection).toBe('audit');
    });
  });

  describe('getPolicies', () => {
    it('should return all policies', () => {
      engine.addPolicy({ collection: 'a', maxAge: 100, action: 'delete' });
      engine.addPolicy({ collection: 'b', maxAge: 200, action: 'archive' });
      engine.addPolicy({ collection: 'c', maxAge: 300, action: 'anonymize' });
      expect(engine.getPolicies()).toHaveLength(3);
    });

    it('should return empty array when no policies', () => {
      expect(engine.getPolicies()).toEqual([]);
    });
  });

  // ── Document Evaluation ──────────────────────────────────

  describe('evaluate', () => {
    it('should identify expired documents for deletion', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });

      const result = engine.evaluate('logs', [
        { _id: 'doc-1', _updatedAt: Date.now() - 5000 },
        { _id: 'doc-2', _updatedAt: Date.now() },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]!.action).toBe('delete');
      expect(result[0]!.documentIds).toContain('doc-1');
      expect(result[0]!.documentIds).not.toContain('doc-2');
    });

    it('should identify expired documents for archival', () => {
      engine.addPolicy({ collection: 'data', maxAge: 2000, action: 'archive' });

      const result = engine.evaluate('data', [{ _id: 'doc-1', _updatedAt: Date.now() - 5000 }]);

      expect(result).toHaveLength(1);
      expect(result[0]!.action).toBe('archive');
    });

    it('should identify expired documents for anonymization', () => {
      engine.addPolicy({ collection: 'users', maxAge: 3000, action: 'anonymize' });

      const result = engine.evaluate('users', [{ _id: 'u1', _updatedAt: Date.now() - 5000 }]);

      expect(result).toHaveLength(1);
      expect(result[0]!.action).toBe('anonymize');
    });

    it('should return empty when no policy exists for collection', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      const result = engine.evaluate('other', [{ _id: 'd1', _updatedAt: 0 }]);
      expect(result).toHaveLength(0);
    });

    it('should return empty when no documents are expired', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 999999999, action: 'delete' });

      const result = engine.evaluate('logs', [
        { _id: 'doc-1', _updatedAt: Date.now() },
        { _id: 'doc-2', _updatedAt: Date.now() },
      ]);

      expect(result).toHaveLength(0);
    });

    it('should return empty for empty document array', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      const result = engine.evaluate('logs', []);
      expect(result).toHaveLength(0);
    });

    it('should identify all expired documents', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });

      const result = engine.evaluate('logs', [
        { _id: 'doc-1', _updatedAt: Date.now() - 5000 },
        { _id: 'doc-2', _updatedAt: Date.now() - 3000 },
        { _id: 'doc-3', _updatedAt: Date.now() - 2000 },
        { _id: 'doc-4', _updatedAt: Date.now() },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0]!.documentIds).toHaveLength(3);
      expect(result[0]!.documentIds).toContain('doc-1');
      expect(result[0]!.documentIds).toContain('doc-2');
      expect(result[0]!.documentIds).toContain('doc-3');
    });

    it('should handle documents at exactly the maxAge boundary', () => {
      const maxAge = 10000;
      engine.addPolicy({ collection: 'logs', maxAge, action: 'delete' });

      // Document at exactly the boundary should NOT be expired
      // (now - updatedAt must be > maxAge, not >=)
      const result = engine.evaluate('logs', [
        { _id: 'boundary', _updatedAt: Date.now() - maxAge },
      ]);
      expect(result).toHaveLength(0);
    });
  });

  // ── Retention Report ─────────────────────────────────────

  describe('generateRetentionReport', () => {
    it('should return report with policies', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      engine.addPolicy({ collection: 'audit', maxAge: 2000, action: 'archive' });

      const report = engine.generateRetentionReport();
      expect(report.policies).toHaveLength(2);
      expect(report.expiredDocuments).toBe(0);
      expect(report.pendingActions).toBe(0);
    });

    it('should return empty report with no policies', () => {
      const report = engine.generateRetentionReport();
      expect(report.policies).toHaveLength(0);
      expect(report.expiredDocuments).toBe(0);
      expect(report.pendingActions).toBe(0);
    });
  });

  // ── Dispose ──────────────────────────────────────────────

  describe('dispose', () => {
    it('should clear all policies', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      engine.addPolicy({ collection: 'audit', maxAge: 2000, action: 'archive' });

      engine.dispose();
      expect(engine.getPolicies()).toHaveLength(0);
    });
  });

  // ── Edge Cases ───────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle overlapping policies (last one wins per collection)', () => {
      const e = createRetentionEngine([
        { collection: 'logs', maxAge: 1000, action: 'delete' },
        { collection: 'logs', maxAge: 5000, action: 'archive' },
      ]);

      const policies = e.getPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0]!.action).toBe('archive');
      expect(policies[0]!.maxAge).toBe(5000);
      e.dispose();
    });

    it('should handle multiple collections independently', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });
      engine.addPolicy({ collection: 'audit', maxAge: 5000, action: 'archive' });

      const oldDoc = { _id: 'old', _updatedAt: Date.now() - 3000 };

      const logsResult = engine.evaluate('logs', [oldDoc]);
      expect(logsResult).toHaveLength(1);
      expect(logsResult[0]!.action).toBe('delete');

      const auditResult = engine.evaluate('audit', [oldDoc]);
      expect(auditResult).toHaveLength(0); // 3000 < 5000 maxAge
    });

    it('should handle very old documents', () => {
      engine.addPolicy({ collection: 'logs', maxAge: 1000, action: 'delete' });

      const result = engine.evaluate('logs', [
        { _id: 'ancient', _updatedAt: 0 }, // epoch time
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]!.documentIds).toContain('ancient');
    });
  });
});
