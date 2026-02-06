import { describe, it, expect } from 'vitest';
import { generateDeployConfig } from '../commands/deploy/config-generator.js';

describe('deploy config generator', () => {
  describe('cloudflare', () => {
    it('creates wrangler.toml', () => {
      const result = generateDeployConfig({
        target: 'cloudflare',
        projectName: 'my-app',
      });

      expect(result.target).toBe('cloudflare');
      const wranglerFile = result.files.find((f) => f.path.includes('wrangler.toml'));
      expect(wranglerFile).toBeDefined();
      expect(wranglerFile!.content).toContain('name = "my-app"');
      expect(wranglerFile!.content).toContain('main = "src/worker.ts"');
      expect(wranglerFile!.content).toContain('compatibility_date');
    });

    it('includes entry point file', () => {
      const result = generateDeployConfig({
        target: 'cloudflare',
        projectName: 'my-app',
      });

      const entryPoint = result.files.find((f) => f.isEntryPoint);
      expect(entryPoint).toBeDefined();
      expect(entryPoint!.path).toContain('worker.ts');
      expect(entryPoint!.content).toContain('createEdgeSyncServer');
    });

    it('includes KV namespace config', () => {
      const result = generateDeployConfig({
        target: 'cloudflare',
        projectName: 'my-app',
        kvNamespaces: ['MY_KV', 'CACHE_KV'],
      });

      const wrangler = result.files.find((f) => f.path.includes('wrangler.toml'))!;
      expect(wrangler.content).toContain('binding = "MY_KV"');
      expect(wrangler.content).toContain('binding = "CACHE_KV"');
    });

    it('includes required tools', () => {
      const result = generateDeployConfig({ target: 'cloudflare' });
      expect(result.requiredTools).toContain('wrangler');
    });
  });

  describe('deno', () => {
    it('creates deno.json', () => {
      const result = generateDeployConfig({
        target: 'deno',
        projectName: 'deno-app',
      });

      expect(result.target).toBe('deno');
      const denoFile = result.files.find((f) => f.path.includes('deno.json'));
      expect(denoFile).toBeDefined();

      const config = JSON.parse(denoFile!.content);
      expect(config.tasks).toBeDefined();
      expect(config.tasks.start).toContain('deno run');
      expect(config.imports).toBeDefined();
    });

    it('includes entry point file', () => {
      const result = generateDeployConfig({ target: 'deno', port: 3000 });
      const entry = result.files.find((f) => f.isEntryPoint);
      expect(entry).toBeDefined();
      expect(entry!.content).toContain('Deno.serve');
      expect(entry!.content).toContain('3000');
    });

    it('includes required tools', () => {
      const result = generateDeployConfig({ target: 'deno' });
      expect(result.requiredTools).toContain('deno');
      expect(result.requiredTools).toContain('deployctl');
    });
  });

  describe('vercel', () => {
    it('creates vercel.json', () => {
      const result = generateDeployConfig({
        target: 'vercel',
        projectName: 'vercel-app',
      });

      expect(result.target).toBe('vercel');
      const vercelFile = result.files.find((f) => f.path.includes('vercel.json'));
      expect(vercelFile).toBeDefined();

      const config = JSON.parse(vercelFile!.content);
      expect(config.name).toBe('vercel-app');
      expect(config.functions).toBeDefined();
      expect(config.routes).toBeDefined();
    });

    it('includes entry point file', () => {
      const result = generateDeployConfig({ target: 'vercel' });
      const entry = result.files.find((f) => f.isEntryPoint);
      expect(entry).toBeDefined();
      expect(entry!.path).toContain('sync.ts');
      expect(entry!.content).toContain("runtime: 'edge'");
    });

    it('includes required tools', () => {
      const result = generateDeployConfig({ target: 'vercel' });
      expect(result.requiredTools).toContain('vercel');
    });
  });

  describe('fly', () => {
    it('creates fly.toml', () => {
      const result = generateDeployConfig({
        target: 'fly',
        projectName: 'fly-app',
      });

      expect(result.target).toBe('fly');
      const flyFile = result.files.find((f) => f.path.includes('fly.toml'));
      expect(flyFile).toBeDefined();
      expect(flyFile!.content).toContain('app = "fly-app"');
      expect(flyFile!.content).toContain('primary_region');
    });

    it('includes Dockerfile', () => {
      const result = generateDeployConfig({ target: 'fly', projectName: 'fly-app' });
      const dockerfile = result.files.find((f) => f.path.includes('Dockerfile'));
      expect(dockerfile).toBeDefined();
      expect(dockerfile!.content).toContain('FROM node:20-slim');
    });

    it('includes entry point file', () => {
      const result = generateDeployConfig({ target: 'fly', port: 9090 });
      const entry = result.files.find((f) => f.isEntryPoint);
      expect(entry).toBeDefined();
      expect(entry!.content).toContain('9090');
    });

    it('includes required tools', () => {
      const result = generateDeployConfig({ target: 'fly' });
      expect(result.requiredTools).toContain('flyctl');
    });
  });

  describe('environment variables', () => {
    it('includes env vars in cloudflare config', () => {
      const result = generateDeployConfig({
        target: 'cloudflare',
        envVars: { DATABASE_URL: 'sqlite:local', API_KEY: 'secret' },
      });

      const wrangler = result.files.find((f) => f.path.includes('wrangler.toml'))!;
      expect(wrangler.content).toContain('DATABASE_URL = "sqlite:local"');
      expect(wrangler.content).toContain('API_KEY = "secret"');
    });

    it('includes env vars in fly config', () => {
      const result = generateDeployConfig({
        target: 'fly',
        envVars: { NODE_ENV: 'production' },
      });

      const flyFile = result.files.find((f) => f.path.includes('fly.toml'))!;
      expect(flyFile.content).toContain('NODE_ENV = "production"');
    });

    it('creates .env file for deno with env vars', () => {
      const result = generateDeployConfig({
        target: 'deno',
        envVars: { DB_URL: 'postgres://localhost' },
      });

      const envFile = result.files.find((f) => f.path.includes('.env'));
      expect(envFile).toBeDefined();
      expect(envFile!.content).toContain('DB_URL=postgres://localhost');
    });

    it('adds env var instructions for vercel', () => {
      const result = generateDeployConfig({
        target: 'vercel',
        envVars: { MY_SECRET: 'value' },
      });

      expect(result.instructions.some((i) => i.includes('MY_SECRET'))).toBe(true);
    });
  });
});
