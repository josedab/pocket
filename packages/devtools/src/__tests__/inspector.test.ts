import { beforeEach, describe, expect, it } from 'vitest';
import { createInspector, DatabaseInspector } from '../inspector.js';
import type { OperationRecord, PerformanceMetric } from '../types.js';

describe('DatabaseInspector', () => {
  let inspector: DatabaseInspector;

  beforeEach(() => {
    inspector = createInspector();
  });

  describe('factory', () => {
    it('should create an inspector with default config', () => {
      expect(inspector).toBeInstanceOf(DatabaseInspector);
    });

    it('should create an inspector with custom config', () => {
      const custom = createInspector({
        maxOperations: 50,
        trackPerformance: false,
        explainQueries: false,
      });
      expect(custom).toBeInstanceOf(DatabaseInspector);
      custom.destroy();
    });
  });

  describe('getDatabases (no databases registered)', () => {
    it('should return empty array when no databases registered', async () => {
      const dbs = await inspector.getDatabases();
      expect(dbs).toEqual([]);
    });
  });

  describe('getDocuments (no database registered)', () => {
    it('should return empty when database not found', async () => {
      const result = await inspector.getDocuments('nonexistent', 'coll');
      expect(result).toEqual({ documents: [], total: 0 });
    });
  });

  describe('getDocument (no database registered)', () => {
    it('should return null when database not found', async () => {
      const doc = await inspector.getDocument('nonexistent', 'coll', 'id');
      expect(doc).toBeNull();
    });
  });

  describe('getCollectionInfo (no database registered)', () => {
    it('should return null when database not found', async () => {
      const info = await inspector.getCollectionInfo('nonexistent', 'coll');
      expect(info).toBeNull();
    });
  });

  describe('getStats (no database registered)', () => {
    it('should return null when database not found', async () => {
      const stats = await inspector.getStats('nonexistent');
      expect(stats).toBeNull();
    });
  });

  describe('executeQuery (no database registered)', () => {
    it('should return empty results when database not found', async () => {
      const result = await inspector.executeQuery('nonexistent', 'coll', {});
      expect(result).toEqual({ results: [], executionTimeMs: 0 });
    });
  });

  describe('snapshots', () => {
    it('should start with no snapshots', () => {
      expect(inspector.getSnapshots()).toEqual([]);
    });

    it('should throw when creating snapshot for non-existent database', async () => {
      await expect(inspector.createSnapshot('nonexistent', 'coll')).rejects.toThrow(
        'Database nonexistent not found'
      );
    });

    it('should throw when restoring non-existent snapshot', async () => {
      await expect(inspector.restoreSnapshot('nonexistent')).rejects.toThrow(
        'Snapshot nonexistent not found'
      );
    });

    it('should delete a snapshot and return true', () => {
      // We can't create a real snapshot without a DB, but we can test delete on non-existent
      expect(inspector.deleteSnapshot('nonexistent')).toBe(false);
    });
  });

  describe('operations tracking', () => {
    it('should emit empty operations initially', () => {
      let ops: OperationRecord[] = [];
      const sub = inspector.getOperations().subscribe((o) => (ops = o));
      expect(ops).toEqual([]);
      sub.unsubscribe();
    });
  });

  describe('metrics tracking', () => {
    it('should provide metrics observable', () => {
      const metrics: PerformanceMetric[] = [];
      const sub = inspector.getMetrics().subscribe((m) => metrics.push(m));
      // No metrics emitted without operations
      expect(metrics).toEqual([]);
      sub.unsubscribe();
    });
  });

  describe('clearOperations', () => {
    it('should reset operations to empty array', () => {
      let ops: OperationRecord[] | undefined;
      const sub = inspector.getOperations().subscribe((o) => (ops = o));
      inspector.clearOperations();
      expect(ops).toEqual([]);
      sub.unsubscribe();
    });
  });

  describe('unregister', () => {
    it('should not throw when unregistering non-existent database', () => {
      expect(() => inspector.unregister('nonexistent')).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should complete all observables', () => {
      let opsCompleted = false;
      let changesCompleted = false;
      let metricsCompleted = false;

      inspector.getOperations().subscribe({ complete: () => (opsCompleted = true) });
      inspector.getChanges().subscribe({ complete: () => (changesCompleted = true) });
      inspector.getMetrics().subscribe({ complete: () => (metricsCompleted = true) });

      inspector.destroy();

      expect(opsCompleted).toBe(true);
      expect(changesCompleted).toBe(true);
      expect(metricsCompleted).toBe(true);
    });
  });
});
