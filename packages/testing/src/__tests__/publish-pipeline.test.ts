import { describe, expect, it } from 'vitest';
import { PublishOrchestrator, type PackageInfo } from '../../../../scripts/publish-pipeline.js';

const testPackages: PackageInfo[] = [
  {
    name: '@pocket/core',
    version: '0.1.0',
    path: 'packages/core',
    private: false,
    dependencies: [],
    hasTests: true,
    hasBuild: true,
    sizeBytes: 25000,
  },
  {
    name: '@pocket/react',
    version: '0.1.0',
    path: 'packages/react',
    private: false,
    dependencies: ['@pocket/core'],
    hasTests: true,
    hasBuild: true,
    sizeBytes: 8000,
  },
  {
    name: '@pocket/sync',
    version: '0.1.0',
    path: 'packages/sync',
    private: false,
    dependencies: ['@pocket/core'],
    hasTests: true,
    hasBuild: true,
    sizeBytes: 12000,
  },
  {
    name: '@pocket/server',
    version: '0.1.0',
    path: 'packages/server',
    private: false,
    dependencies: ['@pocket/sync'],
    hasTests: true,
    hasBuild: true,
    sizeBytes: 15000,
  },
  {
    name: 'pocket-monorepo',
    version: '0.0.0',
    path: '.',
    private: true,
    dependencies: [],
    hasTests: false,
    hasBuild: false,
    sizeBytes: null,
  },
];

describe('PublishOrchestrator', () => {
  it('should determine topological publish order', () => {
    const orch = new PublishOrchestrator();
    const order = orch.getPublishOrder(testPackages.filter((p) => !p.private));
    expect(order.indexOf('@pocket/core')).toBeLessThan(order.indexOf('@pocket/react'));
    expect(order.indexOf('@pocket/core')).toBeLessThan(order.indexOf('@pocket/sync'));
    expect(order.indexOf('@pocket/sync')).toBeLessThan(order.indexOf('@pocket/server'));
  });

  it('should run quality gates and pass for valid packages', () => {
    const orch = new PublishOrchestrator();
    const gates = orch.runQualityGates(testPackages[0]!);
    expect(gates.length).toBeGreaterThanOrEqual(4);
    expect(gates.every((g) => g.passed)).toBe(true);
  });

  it('should fail quality gates for packages without builds', () => {
    const orch = new PublishOrchestrator();
    const pkg: PackageInfo = { ...testPackages[0]!, hasBuild: false };
    const gates = orch.runQualityGates(pkg);
    expect(gates.find((g) => g.gate === 'build')!.passed).toBe(false);
  });

  it('should skip private packages in publish', async () => {
    const orch = new PublishOrchestrator();
    const result = await orch.publish(testPackages);
    expect(result.packages.every((p) => p.package !== 'pocket-monorepo')).toBe(true);
  });

  it('should perform dry run without actually publishing', async () => {
    const orch = new PublishOrchestrator({ dryRun: true });
    const result = await orch.publish(testPackages);
    expect(result.dryRun).toBe(true);
    expect(result.totalPublished).toBe(0);
  });

  it('should publish in correct dependency order', async () => {
    const orch = new PublishOrchestrator();
    const result = await orch.publish(testPackages);
    expect(result.publishOrder[0]).toBe('@pocket/core');
    expect(result.totalPublished).toBe(4);
  });

  it('should exclude specified packages', async () => {
    const orch = new PublishOrchestrator({ excludePackages: ['@pocket/server'] });
    const result = await orch.publish(testPackages);
    expect(result.packages.find((p) => p.package === '@pocket/server')).toBeUndefined();
  });

  it('should format results for terminal display', async () => {
    const orch = new PublishOrchestrator({ dryRun: true });
    const result = await orch.publish(testPackages);
    const output = orch.formatResults(result);
    expect(output).toContain('Publish Pipeline');
    expect(output).toContain('@pocket/core');
  });

  it('should enforce size limits', () => {
    const orch = new PublishOrchestrator();
    const bigPkg: PackageInfo = { ...testPackages[0]!, sizeBytes: 200 * 1024 };
    const gates = orch.runQualityGates(bigPkg);
    expect(gates.find((g) => g.gate === 'size-limit')!.passed).toBe(false);
  });
});
