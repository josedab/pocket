import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createPluginCommand } from '../commands/create-plugin.js';

describe('create-plugin', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-create-plugin-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates correct file structure', async () => {
    const result = await createPluginCommand('my-cache', tmpDir);

    expect(result.files).toContain('package.json');
    expect(result.files).toContain('tsconfig.json');
    expect(result.files).toContain('tsup.config.ts');
    expect(result.files).toContain('src/index.ts');
    expect(result.files).toContain('src/plugin.ts');
    expect(result.files).toContain('src/types.ts');
    expect(result.files).toContain('src/__tests__/plugin.test.ts');
    expect(result.files).toContain('README.md');
    expect(result.files).toContain('LICENSE');

    const pluginDir = path.join(tmpDir, 'pocket-plugin-my-cache');
    for (const file of result.files) {
      expect(fs.existsSync(path.join(pluginDir, file))).toBe(true);
    }
  });

  it('package.json has correct name and deps', async () => {
    await createPluginCommand('my-cache', tmpDir);

    const pkgPath = path.join(tmpDir, 'pocket-plugin-my-cache', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.name).toBe('pocket-plugin-my-cache');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.peerDependencies['@pocket/core']).toBe('^0.1.0');
    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.devDependencies.tsup).toBeDefined();
    expect(pkg.devDependencies.typescript).toBeDefined();
    expect(pkg.license).toBe('MIT');
  });

  it('plugin.ts has correct factory function', async () => {
    await createPluginCommand('my-cache', tmpDir);

    const pluginPath = path.join(tmpDir, 'pocket-plugin-my-cache', 'src', 'plugin.ts');
    const content = fs.readFileSync(pluginPath, 'utf-8');

    expect(content).toContain('export function createMyCachePlugin');
    expect(content).toContain("name: 'pocket-plugin-my-cache'");
    expect(content).toContain("version: '0.1.0'");
    expect(content).toContain('PluginDefinition');
    expect(content).toContain('onInit');
    expect(content).toContain('onDestroy');
  });

  it('test file exists and is valid', async () => {
    await createPluginCommand('my-cache', tmpDir);

    const testPath = path.join(
      tmpDir,
      'pocket-plugin-my-cache',
      'src',
      '__tests__',
      'plugin.test.ts',
    );
    const content = fs.readFileSync(testPath, 'utf-8');

    expect(content).toContain("import { describe, it, expect } from 'vitest'");
    expect(content).toContain('createMyCachePlugin');
    expect(content).toContain("describe('pocket-plugin-my-cache'");
  });

  it('handles invalid plugin names', async () => {
    await expect(createPluginCommand('', tmpDir)).rejects.toThrow('Plugin name is required');

    await expect(createPluginCommand('My-Plugin', tmpDir)).rejects.toThrow(
      'must start with a lowercase letter',
    );

    await expect(createPluginCommand('123bad', tmpDir)).rejects.toThrow(
      'must start with a lowercase letter',
    );
  });

  it('throws if directory already exists', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pocket-plugin-existing'), { recursive: true });
    await expect(createPluginCommand('existing', tmpDir)).rejects.toThrow('Directory already exists');
  });
});
