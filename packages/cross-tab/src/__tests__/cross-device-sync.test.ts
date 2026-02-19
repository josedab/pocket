import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CrossDeviceSync,
  createCrossDeviceSync,
  type DeviceSyncEvent,
} from '../cross-device-sync.js';

describe('CrossDeviceSync', () => {
  let sync: CrossDeviceSync;

  beforeEach(() => {
    sync = createCrossDeviceSync({
      deviceId: 'device-1',
      deviceName: 'MacBook',
      platform: 'desktop',
    });
  });

  afterEach(() => {
    sync.destroy();
  });

  describe('settings CRUD', () => {
    it('should set and get a value', () => {
      sync.set('theme', 'dark');
      expect(sync.get<string>('theme')).toBe('dark');
    });

    it('should return undefined for missing key', () => {
      expect(sync.get('missing')).toBeUndefined();
    });

    it('should get entry with metadata', () => {
      sync.set('fontSize', 16);
      const entry = sync.getEntry<number>('fontSize');
      expect(entry?.value).toBe(16);
      expect(entry?.updatedBy).toBe('device-1');
      expect(entry?.version).toBe(1);
    });

    it('should increment version on update', () => {
      sync.set('theme', 'light');
      sync.set('theme', 'dark');
      expect(sync.getEntry('theme')?.version).toBe(2);
    });

    it('should delete a setting', () => {
      sync.set('theme', 'dark');
      expect(sync.delete('theme')).toBe(true);
      expect(sync.get('theme')).toBeUndefined();
    });

    it('should return false deleting non-existent key', () => {
      expect(sync.delete('missing')).toBe(false);
    });

    it('should list all settings', () => {
      sync.set('a', 1);
      sync.set('b', 2);
      const all = sync.getAll();
      expect(all['a']).toBe(1);
      expect(all['b']).toBe(2);
    });

    it('should list all keys', () => {
      sync.set('x', true);
      sync.set('y', false);
      expect(sync.keys()).toContain('x');
      expect(sync.keys()).toContain('y');
    });
  });

  describe('device management', () => {
    it('should register current device on creation', () => {
      const devices = sync.getDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]!.isCurrentDevice).toBe(true);
    });

    it('should register a remote device', () => {
      sync.registerDevice({
        deviceId: 'device-2',
        deviceName: 'iPhone',
        platform: 'mobile',
        lastSeenAt: Date.now(),
      });
      expect(sync.getDevices()).toHaveLength(2);
    });

    it('should remove a remote device', () => {
      sync.registerDevice({
        deviceId: 'device-2',
        deviceName: 'iPhone',
        platform: 'mobile',
        lastSeenAt: Date.now(),
      });
      expect(sync.removeDevice('device-2')).toBe(true);
      expect(sync.getDevices()).toHaveLength(1);
    });

    it('should not remove current device', () => {
      expect(sync.removeDevice('device-1')).toBe(false);
    });
  });

  describe('conflict resolution', () => {
    it('should accept newer remote settings (LWW)', () => {
      sync.set('theme', 'light');
      sync.applyRemoteSettings([
        {
          key: 'theme',
          value: 'dark',
          updatedAt: Date.now() + 1000,
          updatedBy: 'device-2',
          version: 2,
        },
      ]);
      expect(sync.get('theme')).toBe('dark');
    });

    it('should reject older remote settings (LWW)', () => {
      sync.set('theme', 'light');
      sync.applyRemoteSettings([
        {
          key: 'theme',
          value: 'dark',
          updatedAt: 0, // very old
          updatedBy: 'device-2',
          version: 1,
        },
      ]);
      expect(sync.get('theme')).toBe('light');
    });

    it('should use device priority when configured', () => {
      const s = createCrossDeviceSync({
        deviceId: 'device-1',
        conflictStrategy: 'device-priority',
        devicePriority: ['device-2', 'device-1'],
      });
      s.set('theme', 'light');
      s.applyRemoteSettings([
        {
          key: 'theme',
          value: 'dark',
          updatedAt: 0,
          updatedBy: 'device-2',
          version: 1,
        },
      ]);
      // device-2 has higher priority (lower index), so it wins
      expect(s.get('theme')).toBe('dark');
      s.destroy();
    });
  });

  describe('sync lifecycle', () => {
    it('should report pending state after local changes', () => {
      sync.set('x', 1);
      expect(sync.getStatus().state).toBe('pending');
    });

    it('should report synced state after sync()', () => {
      sync.set('x', 1);
      sync.sync();
      expect(sync.getStatus().state).toBe('synced');
      expect(sync.getStatus().lastSyncAt).not.toBeNull();
    });
  });

  describe('events', () => {
    it('should emit settings-changed on set', () => {
      const events: DeviceSyncEvent[] = [];
      sync.changes$.subscribe((e) => events.push(e));
      sync.set('theme', 'dark');
      expect(events.some((e) => e.type === 'settings-changed')).toBe(true);
    });

    it('should emit device-registered on registerDevice', () => {
      const events: DeviceSyncEvent[] = [];
      sync.changes$.subscribe((e) => events.push(e));
      sync.registerDevice({
        deviceId: 'd2',
        deviceName: 'D2',
        platform: 'mobile',
        lastSeenAt: Date.now(),
      });
      expect(events.some((e) => e.type === 'device-registered')).toBe(true);
    });

    it('should emit sync events', () => {
      const events: DeviceSyncEvent[] = [];
      sync.changes$.subscribe((e) => events.push(e));
      sync.sync();
      expect(events.some((e) => e.type === 'sync-started')).toBe(true);
      expect(events.some((e) => e.type === 'sync-completed')).toBe(true);
    });
  });

  describe('status', () => {
    it('should report correct status', () => {
      sync.set('a', 1);
      sync.set('b', 2);
      const status = sync.getStatus();
      expect(status.settingsCount).toBe(2);
      expect(status.registeredDevices).toBe(1);
      expect(status.pendingChanges).toBe(2);
    });
  });
});
