import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictMetricsTracker, createConflictMetricsTracker } from '../conflict-metrics.js';

describe('ConflictMetricsTracker', () => {
  let tracker: ConflictMetricsTracker;

  beforeEach(() => {
    tracker = createConflictMetricsTracker();
  });

  describe('recording', () => {
    it('should record conflict events', () => {
      const event = tracker.recordConflict({
        documentId: 'doc-1',
        collection: 'todos',
        strategy: 'last-write-wins',
        resolved: true,
        fieldsConflicted: ['title'],
        resolutionDurationMs: 5,
      });
      expect(event.conflictId).toMatch(/^conflict_/);
      expect(event.resolved).toBe(true);
      expect(tracker.getEventCount()).toBe(1);
    });

    it('should enforce max events', () => {
      const small = createConflictMetricsTracker(5);
      for (let i = 0; i < 10; i++) {
        small.recordConflict({
          documentId: `doc-${i}`, collection: 'todos',
          strategy: 'last-write-wins', resolved: true,
          fieldsConflicted: ['title'], resolutionDurationMs: 1,
        });
      }
      expect(small.getEventCount()).toBe(5);
    });
  });

  describe('metrics', () => {
    it('should compute aggregate metrics', () => {
      tracker.recordConflict({
        documentId: 'doc-1', collection: 'todos',
        strategy: 'last-write-wins', resolved: true,
        fieldsConflicted: ['title'], resolutionDurationMs: 10,
      });
      tracker.recordConflict({
        documentId: 'doc-2', collection: 'notes',
        strategy: 'merge', resolved: true,
        fieldsConflicted: ['body', 'title'], resolutionDurationMs: 20,
      });
      tracker.recordConflict({
        documentId: 'doc-3', collection: 'todos',
        strategy: 'last-write-wins', resolved: false,
        fieldsConflicted: ['title'], resolutionDurationMs: 0,
      });

      const metrics = tracker.getMetrics();
      expect(metrics.totalConflicts).toBe(3);
      expect(metrics.resolvedConflicts).toBe(2);
      expect(metrics.unresolvedConflicts).toBe(1);
      expect(metrics.strategyBreakdown['last-write-wins']).toBe(2);
      expect(metrics.strategyBreakdown['merge']).toBe(1);
    });

    it('should track top conflicted fields', () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordConflict({
          documentId: `d${i}`, collection: 'todos',
          strategy: 'last-write-wins', resolved: true,
          fieldsConflicted: ['title'], resolutionDurationMs: 1,
        });
      }
      tracker.recordConflict({
        documentId: 'd5', collection: 'todos',
        strategy: 'merge', resolved: true,
        fieldsConflicted: ['body'], resolutionDurationMs: 1,
      });

      const metrics = tracker.getMetrics();
      expect(metrics.topConflictedFields[0]!.field).toBe('title');
      expect(metrics.topConflictedFields[0]!.count).toBe(5);
    });

    it('should compute average resolution time', () => {
      tracker.recordConflict({
        documentId: 'd1', collection: 'c', strategy: 'merge',
        resolved: true, fieldsConflicted: ['f'], resolutionDurationMs: 10,
      });
      tracker.recordConflict({
        documentId: 'd2', collection: 'c', strategy: 'merge',
        resolved: true, fieldsConflicted: ['f'], resolutionDurationMs: 30,
      });
      expect(tracker.getMetrics().avgResolutionMs).toBe(20);
    });
  });

  describe('querying', () => {
    it('should get conflicts by document ID', () => {
      tracker.recordConflict({ documentId: 'doc-1', collection: 'c', strategy: 'merge', resolved: true, fieldsConflicted: ['f'], resolutionDurationMs: 1 });
      tracker.recordConflict({ documentId: 'doc-2', collection: 'c', strategy: 'merge', resolved: true, fieldsConflicted: ['f'], resolutionDurationMs: 1 });
      expect(tracker.getDocumentConflicts('doc-1')).toHaveLength(1);
    });

    it('should get conflicts by time range', () => {
      const before = Date.now() - 1;
      tracker.recordConflict({ documentId: 'd', collection: 'c', strategy: 'merge', resolved: true, fieldsConflicted: ['f'], resolutionDurationMs: 1 });
      const after = Date.now() + 1;
      expect(tracker.getConflictsByTimeRange(before, after)).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should clear all events', () => {
      tracker.recordConflict({ documentId: 'd', collection: 'c', strategy: 'merge', resolved: true, fieldsConflicted: ['f'], resolutionDurationMs: 1 });
      tracker.clear();
      expect(tracker.getEventCount()).toBe(0);
    });
  });
});
