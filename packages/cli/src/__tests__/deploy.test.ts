import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { deploy, detectFramework } from '../commands/deploy/index.js';

describe('deploy', () => {
  describe('detectFramework', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-detect-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects Next.js (nextjs)', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { next: '^14.0.0' } }),
      );
      expect(detectFramework(tmpDir)).toBe('nextjs');
    });

    it('detects Remix', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { '@remix-run/react': '^2.0.0' } }),
      );
      expect(detectFramework(tmpDir)).toBe('remix');
    });

    it('detects Remix via @remix-run/node', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ devDependencies: { '@remix-run/node': '^2.0.0' } }),
      );
      expect(detectFramework(tmpDir)).toBe('remix');
    });

    it('detects SvelteKit', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { '@sveltejs/kit': '^2.0.0' } }),
      );
      expect(detectFramework(tmpDir)).toBe('sveltekit');
    });

    it('returns plain for unknown dependencies', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { express: '^4.0.0' } }),
      );
      expect(detectFramework(tmpDir)).toBe('plain');
    });

    it('returns plain when no package.json exists', () => {
      expect(detectFramework(tmpDir)).toBe('plain');
    });

    it('returns plain for malformed package.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not valid json');
      expect(detectFramework(tmpDir)).toBe('plain');
    });
  });

  describe('deploy function', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-deploy-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('executes deployment flow', async () => {
      const result = await deploy({
        target: 'cloudflare',
        projectName: 'test-app',
        cwd: tmpDir,
        outputDir: tmpDir,
      });

      expect(result.target).toBe('cloudflare');
      expect(result.projectName).toBe('test-app');
      expect(result.framework).toBe('plain');
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.writtenFiles.length).toBeGreaterThan(0);
      expect(result.dryRun).toBe(false);
    });

    it('with dry-run does not create files', async () => {
      const result = await deploy({
        target: 'cloudflare',
        projectName: 'test-app',
        cwd: tmpDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.writtenFiles).toHaveLength(0);
      expect(result.files.length).toBeGreaterThan(0);
    });

    it('supports cloudflare provider', async () => {
      const result = await deploy({
        target: 'cloudflare',
        projectName: 'cf-app',
        cwd: tmpDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.target).toBe('cloudflare');
      expect(result.requiredTools).toContain('wrangler');
      expect(result.files.some((f) => f.path.includes('wrangler.toml'))).toBe(true);
    });

    it('supports deno provider', async () => {
      const result = await deploy({
        target: 'deno',
        projectName: 'deno-app',
        cwd: tmpDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.target).toBe('deno');
      expect(result.requiredTools).toContain('deno');
      expect(result.files.some((f) => f.path.includes('deno.json'))).toBe(true);
    });

    it('supports vercel provider', async () => {
      const result = await deploy({
        target: 'vercel',
        projectName: 'vercel-app',
        cwd: tmpDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.target).toBe('vercel');
      expect(result.requiredTools).toContain('vercel');
      expect(result.files.some((f) => f.path.includes('vercel.json'))).toBe(true);
    });

    it('supports fly provider', async () => {
      const result = await deploy({
        target: 'fly',
        projectName: 'fly-app',
        cwd: tmpDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.target).toBe('fly');
      expect(result.requiredTools).toContain('flyctl');
      expect(result.files.some((f) => f.path.includes('fly.toml'))).toBe(true);
    });

    it('detects framework and includes notes in nextSteps', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { next: '^14.0.0' } }),
      );

      const result = await deploy({
        target: 'vercel',
        cwd: tmpDir,
        outputDir: tmpDir,
        dryRun: true,
      });

      expect(result.framework).toBe('nextjs');
      expect(result.nextSteps.some((s) => s.includes('Next.js'))).toBe(true);
    });

    it('skips detection when skipDetection is true', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { next: '^14.0.0' } }),
      );

      const result = await deploy({
        target: 'cloudflare',
        cwd: tmpDir,
        outputDir: tmpDir,
        dryRun: true,
        skipDetection: true,
      });

      expect(result.framework).toBe('plain');
    });
  });
});
