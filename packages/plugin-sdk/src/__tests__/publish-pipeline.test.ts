import { describe, it, expect } from 'vitest';
import { publishPlugin } from '../publish-pipeline.js';
import type { PluginScanInput } from '../security-scanner.js';

const VALID_MANIFEST = {
  name: '@pocket/test-plugin',
  version: '1.0.0',
  description: 'A test plugin for Pocket',
  author: 'Test Author',
  category: 'data' as const,
  pocketVersion: '>=0.1.0',
};

const CLEAN_SOURCE = `
import { Plugin } from '@pocket/core';
export const myPlugin = {
  name: 'test',
  version: '1.0.0',
  install(ctx) { ctx.hooks.beforeInsert(async (doc) => doc); },
};
`;

function makeInput(overrides?: Partial<PluginScanInput>): PluginScanInput {
  return {
    manifest: overrides?.manifest ?? VALID_MANIFEST,
    sourceFiles: overrides?.sourceFiles ?? new Map([
      ['src/index.ts', CLEAN_SOURCE],
      ['package.json', '{}'],
    ]),
    dependencies: overrides?.dependencies ?? ['rxjs'],
  };
}

describe('PublishPipeline', () => {
  describe('successful publish', () => {
    it('should return ready for clean plugin with low quality bar', () => {
      const report = publishPlugin(makeInput(), { minQualityScore: 0 });
      expect(report.readiness).toBe('ready');
      expect(report.manifestValid).toBe(true);
      expect(report.structureValid).toBe(true);
    });

    it('should include all check results', () => {
      const report = publishPlugin(makeInput(), { minQualityScore: 0 });
      expect(report.checks.length).toBeGreaterThanOrEqual(3);
      expect(report.checks.every((c) => c.passed)).toBe(true);
    });

    it('should report timing', () => {
      const report = publishPlugin(makeInput());
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
      expect(report.timestamp).toBeGreaterThan(0);
    });
  });

  describe('manifest validation', () => {
    it('should block on invalid manifest', () => {
      const report = publishPlugin(makeInput({
        manifest: { name: '', version: '', description: '', author: '', category: 'data' as const, pocketVersion: '' },
      }));
      expect(report.manifestValid).toBe(false);
      expect(report.checks.some((c) => c.name === 'Manifest Validation' && !c.passed)).toBe(true);
    });
  });

  describe('security scan', () => {
    it('should block on security issues', () => {
      const report = publishPlugin(makeInput({
        sourceFiles: new Map([
          ['src/index.ts', 'const x = eval("1+1"); document.cookie;'],
          ['package.json', '{}'],
        ]),
      }));
      expect(report.securityScan?.passed).toBe(false);
      expect(report.readiness).toBe('blocked');
    });

    it('should skip security when configured', () => {
      const report = publishPlugin(
        makeInput({ sourceFiles: new Map([['src/index.ts', 'eval("x")'], ['package.json', '{}']]) }),
        { skipSecurity: true },
      );
      expect(report.securityScan).toBeNull();
    });
  });

  describe('quality scoring', () => {
    it('should include quality score', () => {
      const report = publishPlugin(makeInput());
      expect(report.qualityScore).not.toBeNull();
      expect(report.qualityScore!.overall).toBeGreaterThanOrEqual(0);
    });

    it('should skip quality when configured', () => {
      const report = publishPlugin(makeInput(), { skipQuality: true });
      expect(report.qualityScore).toBeNull();
    });
  });

  describe('readiness levels', () => {
    it('should be blocked on security critical', () => {
      const report = publishPlugin(makeInput({
        sourceFiles: new Map([['src/index.ts', 'eval("danger")'], ['package.json', '{}']]),
      }));
      expect(report.readiness).toBe('blocked');
    });

    it('should be ready for clean code with low quality bar', () => {
      const report = publishPlugin(makeInput(), { minQualityScore: 0 });
      expect(report.readiness).toBe('ready');
    });
  });

  describe('plugin metadata', () => {
    it('should include plugin name and version', () => {
      const report = publishPlugin(makeInput());
      expect(report.pluginName).toBe('@pocket/test-plugin');
      expect(report.version).toBe('1.0.0');
    });
  });
});
