import { describe, expect, it, beforeEach, vi } from 'vitest';
import { HookSystem, createHookSystem, type HookHandler } from '../hook-system.js';
import {
  PluginLifecycleManager,
  createLifecycleManager,
} from '../lifecycle-manager.js';
import {
  MarketplaceClient,
  createMarketplaceClient,
} from '../marketplace-client.js';

// ─── HookSystem Tests ─────────────────────────────────────────────────────────

describe('HookSystem', () => {
  let hooks: HookSystem;

  beforeEach(() => {
    hooks = createHookSystem();
  });

  it('should register a hook and return registration ID', () => {
    const handler: HookHandler = () => ({ proceed: true });
    const id = hooks.register('plugin-a', 'beforeInsert', handler);

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(hooks.getRegistrations('beforeInsert')).toHaveLength(1);
  });

  it('should execute hooks in priority order (critical > high > normal > low)', async () => {
    const order: string[] = [];

    hooks.register('p1', 'beforeInsert', () => {
      order.push('low');
      return { proceed: true };
    }, 'low');

    hooks.register('p2', 'beforeInsert', () => {
      order.push('critical');
      return { proceed: true };
    }, 'critical');

    hooks.register('p3', 'beforeInsert', () => {
      order.push('normal');
      return { proceed: true };
    }, 'normal');

    hooks.register('p4', 'beforeInsert', () => {
      order.push('high');
      return { proceed: true };
    }, 'high');

    await hooks.execute('beforeInsert', { metadata: {} });

    expect(order).toEqual(['critical', 'high', 'normal', 'low']);
  });

  it('should stop chain when handler returns proceed:false', async () => {
    const order: string[] = [];

    hooks.register('p1', 'beforeInsert', () => {
      order.push('critical');
      return { proceed: false, error: 'blocked' };
    }, 'critical');

    hooks.register('p2', 'beforeInsert', () => {
      order.push('normal');
      return { proceed: true };
    }, 'normal');

    const result = await hooks.execute('beforeInsert', { metadata: {} });

    expect(result.proceed).toBe(false);
    expect(result.error).toBe('blocked');
    expect(order).toEqual(['critical']);
  });

  it('should unregister by ID', () => {
    const handler: HookHandler = () => ({ proceed: true });
    const id = hooks.register('plugin-a', 'beforeInsert', handler);

    expect(hooks.getRegistrations('beforeInsert')).toHaveLength(1);

    const removed = hooks.unregister(id);
    expect(removed).toBe(true);
    expect(hooks.getRegistrations('beforeInsert')).toHaveLength(0);
  });

  it('should unregister all hooks for a plugin', () => {
    const handler: HookHandler = () => ({ proceed: true });

    hooks.register('plugin-a', 'beforeInsert', handler);
    hooks.register('plugin-a', 'afterInsert', handler);
    hooks.register('plugin-b', 'beforeInsert', handler);

    const count = hooks.unregisterPlugin('plugin-a');
    expect(count).toBe(2);
    expect(hooks.getRegistrations()).toHaveLength(1);
    expect(hooks.getRegistrations()[0]!.pluginId).toBe('plugin-b');
  });

  it('should pass modified document through chain', async () => {
    hooks.register('p1', 'beforeInsert', (ctx) => {
      return {
        proceed: true,
        modified: { ...ctx.document, addedByP1: true },
      };
    }, 'high');

    hooks.register('p2', 'beforeInsert', (ctx) => {
      return {
        proceed: true,
        modified: { ...ctx.document, addedByP2: true },
      };
    }, 'normal');

    const result = await hooks.execute('beforeInsert', {
      document: { original: true },
      metadata: {},
    });

    expect(result.proceed).toBe(true);
    expect(result.modified).toEqual({
      original: true,
      addedByP1: true,
      addedByP2: true,
    });
  });
});

// ─── PluginLifecycleManager Tests ─────────────────────────────────────────────

describe('PluginLifecycleManager', () => {
  let manager: PluginLifecycleManager;

  beforeEach(() => {
    manager = createLifecycleManager();
  });

  it('should install a plugin and set status to registered', async () => {
    const instance = await manager.install({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
    });

    expect(instance.id).toBe('test-plugin');
    expect(instance.name).toBe('Test Plugin');
    expect(instance.version).toBe('1.0.0');
    // After install with no hooks, status transitions to 'inactive'
    expect(instance.status).toBe('inactive');
    expect(instance.installedAt).toBeGreaterThan(0);
    expect(manager.isInstalled('test-plugin')).toBe(true);
  });

  it('should activate a plugin', async () => {
    await manager.install({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
    });

    await manager.activate('test-plugin');
    const plugin = manager.getPlugin('test-plugin');

    expect(plugin!.status).toBe('active');
    expect(plugin!.activatedAt).toBeGreaterThan(0);
  });

  it('should deactivate an active plugin', async () => {
    await manager.install({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
    });
    await manager.activate('test-plugin');
    await manager.deactivate('test-plugin');

    const plugin = manager.getPlugin('test-plugin');
    expect(plugin!.status).toBe('inactive');
  });

  it('should list active plugins', async () => {
    await manager.install({ id: 'p1', name: 'P1', version: '1.0.0' });
    await manager.install({ id: 'p2', name: 'P2', version: '1.0.0' });
    await manager.install({ id: 'p3', name: 'P3', version: '1.0.0' });

    await manager.activate('p1');
    await manager.activate('p3');

    const active = manager.getActivePlugins();
    expect(active).toHaveLength(2);
    expect(active.map((p) => p.id).sort()).toEqual(['p1', 'p3']);
  });

  it('should handle lifecycle hook errors gracefully (set status to error)', async () => {
    const instance = await manager.install({
      id: 'bad-plugin',
      name: 'Bad Plugin',
      version: '1.0.0',
      hooks: {
        onActivate: () => {
          throw new Error('activation failed');
        },
      },
    });

    // Install succeeds (status becomes inactive after onInstall)
    expect(instance.status).toBe('inactive');

    await manager.activate('bad-plugin');
    const plugin = manager.getPlugin('bad-plugin');

    expect(plugin!.status).toBe('error');
    expect(plugin!.error).toBe('activation failed');
  });
});

// ─── MarketplaceClient Tests ──────────────────────────────────────────────────

describe('MarketplaceClient', () => {
  let client: MarketplaceClient;

  beforeEach(() => {
    client = createMarketplaceClient();
  });

  it('should search plugins by query', async () => {
    const result = await client.search({ query: 'encryption' });

    expect(result.plugins.length).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(
      result.plugins.some((p) =>
        p.name.toLowerCase().includes('encryption') ||
        p.description.toLowerCase().includes('encryption') ||
        p.tags.some((t) => t.includes('encryption')),
      ),
    ).toBe(true);
  });

  it('should get featured plugins', async () => {
    const featured = await client.getFeatured();

    expect(featured.length).toBeGreaterThan(0);
    // All featured plugins should be verified
    expect(featured.every((p) => p.verified)).toBe(true);
    // Should be sorted by rating descending
    for (let i = 1; i < featured.length; i++) {
      expect(featured[i - 1]!.rating).toBeGreaterThanOrEqual(featured[i]!.rating);
    }
  });

  it('should get popular plugins', async () => {
    const popular = await client.getPopular(3);

    expect(popular).toHaveLength(3);
    // Should be sorted by downloads descending
    for (let i = 1; i < popular.length; i++) {
      expect(popular[i - 1]!.downloads).toBeGreaterThanOrEqual(popular[i]!.downloads);
    }
  });

  it('should get plugins by category', async () => {
    const result = await client.search({ category: 'security' });

    expect(result.plugins.length).toBeGreaterThanOrEqual(1);
    expect(result.plugins.every((p) => p.category === 'security')).toBe(true);
  });
});
