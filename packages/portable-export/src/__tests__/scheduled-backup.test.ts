import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ScheduledBackup,
  createScheduledBackup,
  type BackupDataSource,
  type BackupEvent,
} from '../scheduled-backup.js';

function createMockDataSource(collections: Record<string, Record<string, unknown>[]>): BackupDataSource {
  return {
    collectionNames: () => Object.keys(collections),
    getDocuments: async (name) => collections[name] ?? [],
    getDocumentCount: async (name) => (collections[name] ?? []).length,
  };
}

const MOCK_DATA = {
  todos: [
    { _id: '1', title: 'Buy milk', completed: false },
    { _id: '2', title: 'Walk dog', completed: true },
  ],
  users: [
    { _id: '1', name: 'Alice' },
  ],
};

describe('ScheduledBackup', () => {
  let backup: ScheduledBackup;

  beforeEach(() => {
    backup = createScheduledBackup({
      frequency: 'daily',
      target: 'local',
      format: 'ndjson',
    });
  });

  afterEach(() => {
    backup.destroy();
  });

  describe('manual backup', () => {
    it('should create a backup snapshot', async () => {
      const ds = createMockDataSource(MOCK_DATA);
      const snapshot = await backup.createBackup(ds);
      expect(snapshot.snapshotId).toMatch(/^backup_/);
      expect(snapshot.documentCount).toBe(3);
      expect(snapshot.collections).toContain('todos');
      expect(snapshot.collections).toContain('users');
      expect(snapshot.format).toBe('ndjson');
      expect(snapshot.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should store snapshots in list', async () => {
      const ds = createMockDataSource(MOCK_DATA);
      await backup.createBackup(ds);
      await backup.createBackup(ds);
      expect(backup.listSnapshots()).toHaveLength(2);
    });

    it('should compute storage size', async () => {
      const ds = createMockDataSource(MOCK_DATA);
      await backup.createBackup(ds);
      expect(backup.getTotalStorageBytes()).toBeGreaterThan(0);
    });
  });

  describe('specific collections', () => {
    it('should back up only specified collections', async () => {
      const b = createScheduledBackup({
        frequency: 'daily',
        target: 'local',
        collections: ['todos'],
      });
      const ds = createMockDataSource(MOCK_DATA);
      const snapshot = await b.createBackup(ds);
      expect(snapshot.collections).toEqual(['todos']);
      expect(snapshot.documentCount).toBe(2);
      b.destroy();
    });
  });

  describe('compression', () => {
    it('should estimate reduced size when compression enabled', async () => {
      const b = createScheduledBackup({
        frequency: 'daily',
        target: 'local',
        compress: true,
      });
      const ds = createMockDataSource(MOCK_DATA);
      const snapshot = await b.createBackup(ds);
      expect(snapshot.compressed).toBe(true);
      expect(snapshot.path).toContain('.gz');
      b.destroy();
    });
  });

  describe('snapshot management', () => {
    it('should retrieve snapshot by ID', async () => {
      const ds = createMockDataSource(MOCK_DATA);
      const snapshot = await backup.createBackup(ds);
      const retrieved = backup.getSnapshot(snapshot.snapshotId);
      expect(retrieved?.snapshotId).toBe(snapshot.snapshotId);
    });

    it('should return undefined for unknown ID', () => {
      expect(backup.getSnapshot('nonexistent')).toBeUndefined();
    });

    it('should delete a snapshot', async () => {
      const ds = createMockDataSource(MOCK_DATA);
      const snapshot = await backup.createBackup(ds);
      expect(backup.deleteSnapshot(snapshot.snapshotId)).toBe(true);
      expect(backup.listSnapshots()).toHaveLength(0);
    });

    it('should return false for deleting unknown snapshot', () => {
      expect(backup.deleteSnapshot('nonexistent')).toBe(false);
    });
  });

  describe('retention policy', () => {
    it('should enforce maxTotal retention', async () => {
      const b = createScheduledBackup({
        frequency: 'daily',
        target: 'local',
        retention: { maxTotal: 2 },
      });
      const ds = createMockDataSource(MOCK_DATA);
      await b.createBackup(ds);
      await b.createBackup(ds);
      await b.createBackup(ds);
      expect(b.listSnapshots().length).toBeLessThanOrEqual(2);
      b.destroy();
    });
  });

  describe('events', () => {
    it('should emit backup-started and backup-completed events', async () => {
      const events: BackupEvent[] = [];
      backup.backupEvents$.subscribe((e) => events.push(e));
      const ds = createMockDataSource(MOCK_DATA);
      await backup.createBackup(ds);
      expect(events.some((e) => e.type === 'backup-started')).toBe(true);
      expect(events.some((e) => e.type === 'backup-completed')).toBe(true);
    });
  });

  describe('status', () => {
    it('should report initial status', () => {
      const status = backup.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.totalSnapshots).toBe(0);
      expect(status.lastBackupAt).toBeNull();
    });

    it('should update status after backup', async () => {
      const ds = createMockDataSource(MOCK_DATA);
      await backup.createBackup(ds);
      const status = backup.getStatus();
      expect(status.totalSnapshots).toBe(1);
      expect(status.lastBackupAt).not.toBeNull();
    });
  });

  describe('scheduler', () => {
    it('should start and stop', () => {
      const ds = createMockDataSource(MOCK_DATA);
      backup.start(ds);
      expect(backup.getStatus().isRunning).toBe(true);
      backup.stop();
      expect(backup.getStatus().isRunning).toBe(false);
    });
  });
});
