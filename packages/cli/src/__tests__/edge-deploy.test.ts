import { describe, it, expect } from 'vitest';
import { edgeDeploy } from '../commands/edge-deploy.js';

describe('Edge Deploy CLI', () => {
  describe('cloudflare', () => {
    it('should generate cloudflare worker files', () => {
      const result = edgeDeploy({ platform: 'cloudflare', projectName: 'my-app' });
      expect(result.success).toBe(true);
      expect(result.platform).toBe('cloudflare');
      expect(result.generatedFiles).toHaveLength(2);
      expect(result.generatedFiles[0]!.path).toContain('worker.ts');
      expect(result.generatedFiles[1]!.path).toContain('wrangler.toml');
    });

    it('should include project name in wrangler config', () => {
      const result = edgeDeploy({ platform: 'cloudflare', projectName: 'test-project' });
      expect(result.generatedFiles[1]!.content).toContain('test-project');
    });

    it('should include deployment instructions', () => {
      const result = edgeDeploy({ platform: 'cloudflare' });
      expect(result.instructions.length).toBeGreaterThan(0);
      expect(result.instructions.some((i) => i.includes('wrangler'))).toBe(true);
    });
  });

  describe('deno', () => {
    it('should generate deno deploy files', () => {
      const result = edgeDeploy({ platform: 'deno' });
      expect(result.success).toBe(true);
      expect(result.platform).toBe('deno');
      expect(result.generatedFiles).toHaveLength(1);
      expect(result.generatedFiles[0]!.path).toContain('main.ts');
    });

    it('should include deno-specific imports', () => {
      const result = edgeDeploy({ platform: 'deno' });
      expect(result.generatedFiles[0]!.content).toContain('Deno');
    });
  });

  describe('vercel', () => {
    it('should generate vercel edge function', () => {
      const result = edgeDeploy({ platform: 'vercel' });
      expect(result.success).toBe(true);
      expect(result.generatedFiles[0]!.path).toContain('api/sync.ts');
      expect(result.generatedFiles[0]!.content).toContain("runtime: 'edge'");
    });
  });

  describe('bun', () => {
    it('should generate bun server file', () => {
      const result = edgeDeploy({ platform: 'bun' });
      expect(result.success).toBe(true);
      expect(result.generatedFiles[0]!.content).toContain('Bun.serve');
    });
  });

  describe('output directory', () => {
    it('should respect custom output directory', () => {
      const result = edgeDeploy({ platform: 'cloudflare', outputDir: './deploy' });
      expect(result.generatedFiles[0]!.path).toContain('./deploy');
    });

    it('should use current directory by default', () => {
      const result = edgeDeploy({ platform: 'deno' });
      expect(result.generatedFiles[0]!.path).toContain('.');
    });
  });

  describe('all platforms produce valid output', () => {
    it('should have success and instructions for all platforms', () => {
      const platforms = ['cloudflare', 'deno', 'vercel', 'bun'] as const;
      for (const platform of platforms) {
        const result = edgeDeploy({ platform });
        expect(result.success).toBe(true);
        expect(result.generatedFiles.length).toBeGreaterThan(0);
        expect(result.instructions.length).toBeGreaterThan(0);
        for (const file of result.generatedFiles) {
          expect(file.content.length).toBeGreaterThan(0);
          expect(file.description.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
