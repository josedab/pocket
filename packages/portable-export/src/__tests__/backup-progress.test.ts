import { describe, it, expect, beforeEach } from 'vitest';
import { BackupProgressTracker, createBackupProgressTracker } from '../backup-progress.js';
import type { BackupProgress } from '../backup-progress.js';

describe('BackupProgressTracker', () => {
  let tracker: BackupProgressTracker;

  beforeEach(() => {
    tracker = createBackupProgressTracker('backup_test_123');
  });

  describe('initialization', () => {
    it('should start with 0% progress', () => {
      const p = tracker.getProgress();
      expect(p.snapshotId).toBe('backup_test_123');
      expect(p.overallPercent).toBe(0);
      expect(p.status).toBe('running');
    });
  });

  describe('collection tracking', () => {
    it('should track collection progress', () => {
      tracker.setTotalCollections(2);
      tracker.startCollection('todos', 100);
      tracker.updateCollection('todos', 50, 5000);

      const p = tracker.getProgress();
      expect(p.collections).toHaveLength(1);
      expect(p.collections[0]!.collection).toBe('todos');
      expect(p.collections[0]!.percentComplete).toBe(50);
      expect(p.collections[0]!.bytesWritten).toBe(5000);
    });

    it('should mark collection complete', () => {
      tracker.startCollection('todos', 100);
      tracker.completeCollection('todos');

      const p = tracker.getProgress();
      expect(p.collections[0]!.status).toBe('complete');
      expect(p.collections[0]!.percentComplete).toBe(100);
    });

    it('should mark collection errored', () => {
      tracker.startCollection('todos', 100);
      tracker.errorCollection('todos', 'disk full');

      expect(tracker.getProgress().collections[0]!.status).toBe('error');
    });
  });

  describe('overall progress', () => {
    it('should compute overall percentage from collections', () => {
      tracker.setTotalCollections(2);
      tracker.startCollection('a', 100);
      tracker.startCollection('b', 100);
      tracker.updateCollection('a', 100, 1000);
      tracker.updateCollection('b', 50, 500);

      const p = tracker.getProgress();
      expect(p.overallPercent).toBe(75); // (100+50)/200 * 100
    });

    it('should track total bytes', () => {
      tracker.startCollection('a', 10);
      tracker.updateCollection('a', 10, 5000);
      tracker.startCollection('b', 10);
      tracker.updateCollection('b', 10, 3000);

      expect(tracker.getProgress().totalBytesWritten).toBe(8000);
    });

    it('should count completed collections', () => {
      tracker.setTotalCollections(3);
      tracker.startCollection('a', 10);
      tracker.completeCollection('a');
      tracker.startCollection('b', 10);

      expect(tracker.getProgress().collectionsProcessed).toBe(1);
    });
  });

  describe('ETA estimation', () => {
    it('should estimate remaining time during progress', () => {
      tracker.startCollection('todos', 100);
      tracker.updateCollection('todos', 50, 5000);

      const p = tracker.getProgress();
      // With 50% done, ETA should be roughly equal to elapsed
      expect(p.estimatedRemainingMs).not.toBeNull();
      expect(p.estimatedRemainingMs!).toBeGreaterThanOrEqual(0);
    });

    it('should return null when no progress', () => {
      expect(tracker.getProgress().estimatedRemainingMs).toBeNull();
    });
  });

  describe('observable progress', () => {
    it('should emit progress updates', () => {
      const updates: BackupProgress[] = [];
      tracker.progress$.subscribe((p) => updates.push(p));

      tracker.startCollection('todos', 100);
      tracker.updateCollection('todos', 50, 1000);
      tracker.completeCollection('todos');
      tracker.complete();

      expect(updates.length).toBeGreaterThan(0);
      const last = updates[updates.length - 1]!;
      expect(last.status).toBe('complete');
    });
  });

  describe('completion', () => {
    it('should mark as complete', () => {
      tracker.complete();
      expect(tracker.getProgress().status).toBe('complete');
    });

    it('should mark as failed with error', () => {
      tracker.fail('Network error');
      const p = tracker.getProgress();
      expect(p.status).toBe('error');
      expect(p.error).toBe('Network error');
    });
  });
});
