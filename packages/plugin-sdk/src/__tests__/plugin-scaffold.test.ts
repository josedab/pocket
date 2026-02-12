import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginScaffold, createPluginScaffold } from '../plugin-scaffold.js';
import type { PluginManifest } from '../types.js';

describe('PluginScaffold', () => {
  let scaffold: PluginScaffold;

  const testManifest: PluginManifest = {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin for comprehensive testing',
    author: 'Test Author',
    category: 'sync',
    pocketVersion: '>=0.1.0',
  };

  beforeEach(() => {
    scaffold = createPluginScaffold();
  });

  afterEach(() => {
    scaffold.destroy();
  });

  it('should generate scaffold files', () => {
    const files = scaffold.generate({
      name: 'my-sync',
      category: 'sync',
      author: 'Dev',
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/__tests__/index.test.ts');
    expect(paths).toContain('tsconfig.json');
    expect(paths).toContain('README.md');
    expect(paths).toContain('CHANGELOG.md');
    expect(files).toHaveLength(7);
  });

  it('should generate valid package.json', () => {
    const files = scaffold.generate({
      name: 'analytics',
      category: 'analytics',
      author: 'Alice',
      description: 'Analytics plugin',
      pocketVersion: '0.5.0',
    });

    const pkgFile = files.find((f) => f.path === 'package.json');
    expect(pkgFile).toBeDefined();
    const pkg = JSON.parse(pkgFile!.content);
    expect(pkg.name).toBe('pocket-plugin-analytics');
    expect(pkg.author).toBe('Alice');
    expect(pkg.peerDependencies['@pocket/core']).toBe('^0.5.0');
  });

  it('should include hooks in manifest', () => {
    const files = scaffold.generate({
      name: 'validator',
      category: 'data',
      author: 'Bob',
      hooks: ['beforeInsert', 'beforeUpdate'],
    });

    const manifestFile = files.find((f) => f.path === 'manifest.json');
    const manifest = JSON.parse(manifestFile!.content);
    expect(manifest.hooks).toEqual(['beforeInsert', 'beforeUpdate']);
  });

  it('should score high-quality plugins', () => {
    const score = scaffold.score(testManifest, {
      hasReadme: true,
      hasChangelog: true,
      hasExamples: true,
      hasTests: true,
      testCount: 15,
      hasTypeDefinitions: true,
      codeLines: 500,
      dependencyCount: 2,
    });

    expect(score.overall).toBeGreaterThan(80);
    expect(score.breakdown.documentation).toBeGreaterThan(20);
    expect(score.breakdown.testing).toBeGreaterThan(20);
    expect(score.suggestions).toHaveLength(0);
  });

  it('should score low-quality plugins with suggestions', () => {
    const bareManifest: PluginManifest = {
      name: 'bare',
      version: '0.1.0',
      description: 'x',
      author: '',
      category: 'other',
      pocketVersion: '',
      entryPoint: '',
    };

    const score = scaffold.score(bareManifest, {});
    expect(score.overall).toBeLessThan(30);
    expect(score.suggestions.length).toBeGreaterThan(3);
  });

  it('should check compatibility for matching versions', () => {
    const result = scaffold.checkCompatibility(testManifest, '0.5.0');
    expect(result.compatible).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should detect incompatible major versions', () => {
    const manifest: PluginManifest = {
      ...testManifest,
      pocketVersion: '>=2.0.0',
    };

    const result = scaffold.checkCompatibility(manifest, '1.0.0');
    expect(result.compatible).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should warn about older major versions', () => {
    const manifest: PluginManifest = {
      ...testManifest,
      pocketVersion: '>=0.1.0',
    };

    const result = scaffold.checkCompatibility(manifest, '1.0.0');
    expect(result.compatible).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should run publish pipeline successfully', async () => {
    const result = await scaffold.publish(testManifest, {
      hasTests: true,
      testCount: 5,
      hasReadme: true,
    });

    expect(result.success).toBe(true);
    expect(result.stages).toHaveLength(6);
    expect(result.packageId).toBe('test-plugin@1.0.0');
  });

  it('should fail publish on missing manifest fields', async () => {
    const badManifest: PluginManifest = {
      name: '',
      version: '0.1.0',
      description: '',
      author: '',
      category: 'other',
      pocketVersion: '',
      entryPoint: '',
    };

    const result = await scaffold.publish(badManifest);
    expect(result.success).toBe(false);
    expect(result.stages[0]!.error).toContain('Manifest missing name');
  });

  it('should emit progress during publish', async () => {
    const stages: string[] = [];
    scaffold.progress$.subscribe((p) => {
      if (p) stages.push(`${p.stage}:${p.status}`);
    });

    await scaffold.publish(testManifest, { hasTests: true, testCount: 5, hasReadme: true });

    expect(stages.length).toBeGreaterThan(0);
    expect(stages.some((s) => s.includes('validate'))).toBe(true);
    expect(stages.some((s) => s.includes('publish'))).toBe(true);
  });
});
