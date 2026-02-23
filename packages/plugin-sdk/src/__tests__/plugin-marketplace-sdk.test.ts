import { describe, it, expect, beforeEach } from 'vitest';
import {
  PluginMarketplaceSDK,
  createPluginMarketplaceSDK,
} from '../plugin-marketplace-sdk.js';

describe('PluginMarketplaceSDK', () => {
  let sdk: PluginMarketplaceSDK;

  beforeEach(() => {
    sdk = createPluginMarketplaceSDK();
  });

  // ── Creation ────────────────────────────────────────────────────────

  it('should create SDK with default config', () => {
    expect(sdk).toBeInstanceOf(PluginMarketplaceSDK);
  });

  it('should create SDK with custom config', () => {
    const custom = createPluginMarketplaceSDK({
      registryUrl: 'https://custom.registry.dev',
      enableQualityScoring: false,
      cacheEnabled: false,
    });
    expect(custom).toBeInstanceOf(PluginMarketplaceSDK);
  });

  // ── Install / Uninstall ─────────────────────────────────────────────

  it('should install a plugin', async () => {
    const installed = await sdk.install('@pocket/encryption');
    expect(installed.name).toBe('@pocket/encryption');
    expect(installed.version).toBe('1.0.0');
    expect(installed.installedAt).toBeGreaterThan(0);
  });

  it('should uninstall an installed plugin', async () => {
    await sdk.install('@pocket/encryption');
    const removed = await sdk.uninstall('@pocket/encryption');
    expect(removed).toBe(true);
  });

  it('should return false when uninstalling unknown plugin', async () => {
    const removed = await sdk.uninstall('@pocket/nonexistent');
    expect(removed).toBe(false);
  });

  // ── Get Installed ──────────────────────────────────────────────────

  it('should return empty list initially', () => {
    expect(sdk.getInstalled()).toEqual([]);
  });

  it('should return installed plugins', async () => {
    await sdk.install('@pocket/encryption');
    await sdk.install('@pocket/analytics');
    const installed = sdk.getInstalled();
    expect(installed).toHaveLength(2);
    expect(installed.map((p) => p.name)).toContain('@pocket/encryption');
    expect(installed.map((p) => p.name)).toContain('@pocket/analytics');
  });

  // ── Search ─────────────────────────────────────────────────────────

  it('should return search results', async () => {
    const results = await sdk.search('encryption');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].plugin.name).toBe('@pocket/encryption');
  });

  it('should attach quality scores when enabled', async () => {
    const results = await sdk.search('encryption');
    expect(results[0].qualityScore).toBeDefined();
    expect(results[0].qualityScore!.overall).toBeGreaterThan(0);
  });

  it('should omit quality scores when disabled', async () => {
    const noScoreSdk = createPluginMarketplaceSDK({
      enableQualityScoring: false,
    });
    const results = await noScoreSdk.search('encryption');
    expect(results[0].qualityScore).toBeUndefined();
  });

  // ── Stats ──────────────────────────────────────────────────────────

  it('should track stats correctly', async () => {
    await sdk.search('encryption');
    await sdk.install('@pocket/encryption');
    await sdk.install('@pocket/analytics');
    await sdk.uninstall('@pocket/encryption');

    const stats = sdk.getStats();
    expect(stats.totalSearches).toBe(1);
    expect(stats.totalInstalls).toBe(2);
    expect(stats.totalUninstalls).toBe(1);
    expect(stats.installedCount).toBe(1);
  });
});
