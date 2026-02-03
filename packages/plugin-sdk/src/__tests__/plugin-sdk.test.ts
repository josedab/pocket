import { describe, it, expect, beforeEach } from 'vitest';
import { validateManifest, validatePluginStructure } from '../validator.js';
import { PluginTestHarness, createPluginTestHarness } from '../test-harness.js';
import { RegistryClient, createRegistryClient } from '../registry-client.js';
import type { PluginInstallFn } from '../test-harness.js';

// ── Validator ───────────────────────────────────────────────────────

describe('validateManifest', () => {
  const validManifest = {
    name: '@pocket/timestamps',
    version: '1.0.0',
    description: 'Automatic timestamp management for Pocket',
    author: 'Pocket Contributors',
    category: 'data' as const,
    pocketVersion: '>=0.1.0',
    license: 'MIT',
    keywords: ['timestamps', 'dates'],
    repository: 'https://github.com/example/plugin',
  };

  it('should validate a correct manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing name', () => {
    const result = validateManifest({ ...validManifest, name: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('should reject invalid version', () => {
    const result = validateManifest({ ...validManifest, version: 'abc' });
    expect(result.valid).toBe(false);
  });

  it('should reject missing description', () => {
    const result = validateManifest({ ...validManifest, description: '' });
    expect(result.valid).toBe(false);
  });

  it('should reject invalid category', () => {
    const result = validateManifest({ ...validManifest, category: 'invalid' as never });
    expect(result.valid).toBe(false);
  });

  it('should warn about missing optional fields', () => {
    const { license, keywords, repository, ...minimal } = validManifest;
    const result = validateManifest(minimal);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('validatePluginStructure', () => {
  it('should validate correct structure', () => {
    const result = validatePluginStructure([
      'package.json',
      'src/index.ts',
      'src/plugin.test.ts',
      'README.md',
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should error on missing package.json', () => {
    const result = validatePluginStructure(['src/index.ts']);
    expect(result.valid).toBe(false);
  });

  it('should error on missing entry point', () => {
    const result = validatePluginStructure(['package.json']);
    expect(result.valid).toBe(false);
  });

  it('should warn on missing tests', () => {
    const result = validatePluginStructure(['package.json', 'src/index.ts']);
    expect(result.warnings.some((w) => w.includes('test'))).toBe(true);
  });
});

// ── Test Harness ────────────────────────────────────────────────────

describe('PluginTestHarness', () => {
  let harness: PluginTestHarness;

  // Sample plugin: adds timestamps
  const timestampPlugin: PluginInstallFn = ({ hooks }) => {
    hooks.beforeInsert(async (doc) => {
      return { ...doc, createdAt: new Date('2025-01-01').toISOString() };
    });
    hooks.afterInsert(async () => {
      // Analytics tracking would go here
    });
  };

  beforeEach(() => {
    harness = createPluginTestHarness();
  });

  it('should install a plugin', () => {
    harness.install(timestampPlugin);
    expect(harness.getHookCount()).toBe(2);
  });

  it('should run beforeInsert hooks', async () => {
    harness.install(timestampPlugin);
    const doc = await harness.simulateInsert('users', { name: 'Alice' });
    expect(doc.createdAt).toBe(new Date('2025-01-01').toISOString());
    expect(doc.name).toBe('Alice');
  });

  it('should persist documents in mock database', async () => {
    harness.install(timestampPlugin);
    await harness.simulateInsert('users', { _id: 'u1', name: 'Alice' });
    const found = await harness.db.collection('users').get('u1');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Alice');
  });

  it('should run update hooks', async () => {
    const auditLog: string[] = [];
    const auditPlugin: PluginInstallFn = ({ hooks }) => {
      hooks.afterUpdate(async (doc) => {
        auditLog.push(`Updated: ${(doc as { _id: string })._id}`);
      });
    };

    harness.install(auditPlugin);
    await harness.simulateInsert('users', { _id: 'u1', name: 'Alice' });
    await harness.simulateUpdate('users', 'u1', { name: 'Alice Updated' });
    expect(auditLog).toContain('Updated: u1');
  });

  it('should run named test cases', async () => {
    harness.install(timestampPlugin);
    const result = await harness.runTest('timestamps are added', async (h) => {
      const doc = await h.simulateInsert('users', { name: 'Test' });
      if (!doc.createdAt) throw new Error('No timestamp');
    });
    expect(result.passed).toBe(true);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('should report failed test cases', async () => {
    const result = await harness.runTest('should fail', async () => {
      throw new Error('Expected failure');
    });
    expect(result.passed).toBe(false);
    expect(result.error).toBe('Expected failure');
  });

  it('should initialize with seed data', async () => {
    harness = createPluginTestHarness({
      collections: {
        users: [
          { _id: 'u1', name: 'Alice' },
          { _id: 'u2', name: 'Bob' },
        ],
      },
    });

    const users = await harness.db.collection('users').find();
    expect(users.length).toBe(2);
  });
});

// ── Registry Client ─────────────────────────────────────────────────

describe('RegistryClient', () => {
  let client: RegistryClient;

  beforeEach(() => {
    client = createRegistryClient({ registryUrl: 'https://test-registry.example.com' });

    client.registerLocal({
      name: '@pocket/timestamps',
      version: '1.0.0',
      description: 'Automatic timestamp management',
      author: 'Alice',
      category: 'data',
      downloads: 5000,
      rating: 4.5,
      keywords: ['timestamps', 'dates'],
    });

    client.registerLocal({
      name: '@pocket/encryption',
      version: '2.0.0',
      description: 'End-to-end encryption for Pocket',
      author: 'Bob',
      category: 'security',
      downloads: 3000,
      rating: 4.8,
      keywords: ['encryption', 'security', 'e2e'],
    });

    client.registerLocal({
      name: '@pocket/analytics',
      version: '0.5.0',
      description: 'Offline-first analytics tracking',
      author: 'Charlie',
      category: 'analytics',
      downloads: 1000,
      rating: 4.0,
      keywords: ['analytics', 'tracking'],
    });
  });

  it('should search plugins by query', async () => {
    const results = await client.search('timestamp');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('@pocket/timestamps');
  });

  it('should search plugins by keyword', async () => {
    const results = await client.search('security');
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('@pocket/encryption');
  });

  it('should filter by category', async () => {
    const results = await client.search('', { category: 'security' });
    expect(results.length).toBe(1);
  });

  it('should get plugin by name', async () => {
    const plugin = await client.getPlugin('@pocket/encryption');
    expect(plugin).toBeDefined();
    expect(plugin!.version).toBe('2.0.0');
  });

  it('should list by category', async () => {
    const results = await client.listByCategory('data');
    expect(results.length).toBe(1);
  });

  it('should get featured plugins sorted by rating', async () => {
    const featured = await client.getFeatured(2);
    expect(featured.length).toBe(2);
    expect(featured[0]!.rating).toBeGreaterThanOrEqual(featured[1]!.rating);
  });

  it('should track catalog size', () => {
    expect(client.catalogSize).toBe(3);
  });

  it('should use custom registry URL', () => {
    expect(client.getRegistryUrl()).toBe('https://test-registry.example.com');
  });
});
