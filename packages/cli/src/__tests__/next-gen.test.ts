import { describe, expect, it } from 'vitest';
import {
  formatBenchmarkReport,
  generateCollectionCode,
  runBenchmark,
  runHealthCheck,
  scaffold,
} from '../index.js';

describe('scaffold', () => {
  it('should generate basic project files', () => {
    const result = scaffold({
      name: 'my-app',
      template: 'basic',
      collections: ['todos', 'users'],
    });

    expect(result.success).toBe(true);
    expect(result.files.length).toBeGreaterThanOrEqual(3);

    const packageJson = result.files.find((f) => f.path.includes('package.json'));
    expect(packageJson).toBeDefined();
    expect(packageJson!.content).toContain('my-app');
  });

  it('should generate React project with App.tsx', () => {
    const result = scaffold({
      name: 'react-app',
      template: 'react',
      collections: ['todos'],
    });

    expect(result.success).toBe(true);
    const appFile = result.files.find((f) => f.path.includes('App.tsx'));
    expect(appFile).toBeDefined();
    expect(appFile!.content).toContain('PocketProvider');
  });

  it('should include sync dependencies when requested', () => {
    const result = scaffold({
      name: 'sync-app',
      template: 'basic',
      withSync: true,
    });

    const packageJson = result.files.find((f) => f.path.includes('package.json'));
    expect(packageJson!.content).toContain('@pocket/sync');
  });

  it('should include collection types in database setup', () => {
    const result = scaffold({
      name: 'typed-app',
      template: 'basic',
      collections: ['users', 'posts'],
    });

    const dbFile = result.files.find((f) => f.path.includes('database.ts'));
    expect(dbFile).toBeDefined();
    expect(dbFile!.content).toContain('interface Users');
    expect(dbFile!.content).toContain('interface Posts');
  });

  it('should generate pocket.config.ts', () => {
    const result = scaffold({
      name: 'config-app',
      template: 'basic',
      collections: ['items'],
    });

    const config = result.files.find((f) => f.path.includes('pocket.config.ts'));
    expect(config).toBeDefined();
    expect(config!.content).toContain('defineConfig');
    expect(config!.content).toContain('items');
  });

  it('should generate install commands', () => {
    const result = scaffold({
      name: 'cmd-app',
      template: 'basic',
      packageManager: 'pnpm',
    });

    expect(result.commands).toContain('pnpm install');
  });
});

describe('generateCollectionCode', () => {
  it('should generate typed collection interface', () => {
    const code = generateCollectionCode('users', [
      { name: 'name', type: 'string', required: true },
      { name: 'age', type: 'number', required: false },
    ]);

    expect(code).toContain('interface Users');
    expect(code).toContain('name: string');
    expect(code).toContain('age?: number');
    expect(code).toContain("'users'");
  });
});

describe('runHealthCheck', () => {
  it('should pass with valid configuration', () => {
    const report = runHealthCheck({
      configPath: 'pocket.config.ts',
      hasDatabase: true,
      hasCollections: true,
      hasTests: true,
      nodeVersion: 'v20.0.0',
    });

    expect(report.healthy).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(5);
  });

  it('should fail with old Node.js', () => {
    const report = runHealthCheck({
      nodeVersion: 'v16.0.0',
      hasDatabase: true,
    });

    expect(report.healthy).toBe(false);
    const nodeCheck = report.items.find((i) => i.name === 'Node.js Version');
    expect(nodeCheck?.status).toBe('fail');
  });

  it('should warn on missing config', () => {
    const report = runHealthCheck({
      hasDatabase: true,
    });

    const configCheck = report.items.find((i) => i.name === 'Config File');
    expect(configCheck?.status).toBe('warn');
  });
});

describe('runBenchmark', () => {
  it('should run benchmark suite', async () => {
    const report = await runBenchmark({
      insert: async () => {},
      query: async () => 10,
      update: async () => {},
      remove: async () => {},
      iterations: 5,
    });

    expect(report.results).toHaveLength(5);
    expect(report.results[0]!.name).toBe('Insert (single)');
    expect(report.totalDurationMs).toBeGreaterThan(0);

    for (const result of report.results) {
      expect(result.avgMs).toBeGreaterThanOrEqual(0);
      expect(result.opsPerSecond).toBeGreaterThan(0);
      expect(result.iterations).toBeGreaterThan(0);
    }
  });

  it('should format report as table', async () => {
    const report = await runBenchmark({
      insert: async () => {},
      query: async () => 0,
      update: async () => {},
      remove: async () => {},
      iterations: 3,
    });

    const formatted = formatBenchmarkReport(report);
    expect(formatted).toContain('POCKET BENCHMARK');
    expect(formatted).toContain('Insert');
    expect(formatted).toContain('Query');
    expect(formatted).toContain('Ops/sec');
  });
});
