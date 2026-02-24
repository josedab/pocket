import { beforeEach, describe, expect, it } from 'vitest';
import { PluginInstaller } from '../plugin-installer.js';

describe('PluginInstaller', () => {
  let installer: PluginInstaller;

  beforeEach(() => {
    installer = new PluginInstaller({ pocketVersion: '0.1.0' });
  });

  describe('install', () => {
    it('should install a plugin', async () => {
      const result = await installer.install('pocket-plugin-analytics');
      expect(result.installed).toBe(true);
      expect(result.name).toBe('pocket-plugin-analytics');
      expect(result.version).toBe('1.0.0');
      expect(result.alreadyInstalled).toBe(false);
    });

    it('should not reinstall an already installed plugin', async () => {
      await installer.install('pocket-plugin-analytics');
      const result = await installer.install('pocket-plugin-analytics');
      expect(result.installed).toBe(false);
      expect(result.alreadyInstalled).toBe(true);
    });

    it('should install with specific version', async () => {
      const result = await installer.install('pocket-plugin-auth', '2.0.0');
      expect(result.version).toBe('2.0.0');
    });
  });

  describe('uninstall', () => {
    it('should uninstall an installed plugin', async () => {
      await installer.install('pocket-plugin-analytics');
      const result = await installer.uninstall('pocket-plugin-analytics');
      expect(result.uninstalled).toBe(true);
      expect(installer.getInstalled('pocket-plugin-analytics')).toBeUndefined();
    });

    it('should fail to uninstall a non-installed plugin', async () => {
      const result = await installer.uninstall('nonexistent');
      expect(result.uninstalled).toBe(false);
      expect(result.error).toContain('not installed');
    });
  });

  describe('listInstalled', () => {
    it('should list all installed plugins', async () => {
      await installer.install('plugin-a');
      await installer.install('plugin-b');
      await installer.install('plugin-c');

      const list = installer.listInstalled();
      expect(list.length).toBe(3);
      expect(list.map((p) => p.name)).toContain('plugin-a');
      expect(list.map((p) => p.name)).toContain('plugin-b');
      expect(list.map((p) => p.name)).toContain('plugin-c');
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable a plugin', async () => {
      await installer.install('pocket-plugin-auth');

      installer.setEnabled('pocket-plugin-auth', false);
      expect(installer.getInstalled('pocket-plugin-auth')?.enabled).toBe(false);

      installer.setEnabled('pocket-plugin-auth', true);
      expect(installer.getInstalled('pocket-plugin-auth')?.enabled).toBe(true);
    });

    it('should return false for non-installed plugin', () => {
      expect(installer.setEnabled('nonexistent', true)).toBe(false);
    });
  });

  describe('checkUpdates', () => {
    it('should check for updates', async () => {
      await installer.install('plugin-a');
      const updates = await installer.checkUpdates();
      expect(updates.length).toBe(1);
      expect(updates[0]!.name).toBe('plugin-a');
      expect(updates[0]!.currentVersion).toBe('1.0.0');
    });
  });

  describe('events', () => {
    it('should emit install events', async () => {
      const events: unknown[] = [];
      installer.events$.subscribe((e) => events.push(e));

      await installer.install('pocket-plugin-test');

      const types = events.map((e) => (e as { type: string }).type);
      expect(types).toContain('install:start');
      expect(types).toContain('install:complete');
    });

    it('should emit uninstall events', async () => {
      await installer.install('pocket-plugin-test');

      const events: unknown[] = [];
      installer.events$.subscribe((e) => events.push(e));

      await installer.uninstall('pocket-plugin-test');

      const types = events.map((e) => (e as { type: string }).type);
      expect(types).toContain('uninstall:complete');
    });
  });

  describe('update', () => {
    it('should update an installed plugin', async () => {
      await installer.install('pocket-plugin-test', '1.0.0');
      const result = await installer.update('pocket-plugin-test');
      expect(result.installed).toBe(true);
    });
  });
});
