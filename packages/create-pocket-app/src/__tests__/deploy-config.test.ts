import { describe, it, expect } from 'vitest';
import {
  generateDeployFiles,
  getSupportedPlatforms,
  getSupportedFrameworks,
} from '../deploy-config.js';
import type { DeployConfig } from '../deploy-config.js';

const baseConfig: DeployConfig = {
  platform: 'vercel',
  framework: 'nextjs',
  includeSyncServer: true,
  databaseName: 'test-app',
};

describe('generateDeployFiles', () => {
  describe('Vercel', () => {
    it('should generate vercel.json', () => {
      const result = generateDeployFiles(baseConfig);
      const vercelJson = result.files.find((f) => f.path === 'vercel.json');
      expect(vercelJson).toBeDefined();
      expect(vercelJson?.content).toContain('$schema');
    });

    it('should include sync server route when enabled', () => {
      const result = generateDeployFiles(baseConfig);
      const syncFile = result.files.find((f) => f.path === 'api/pocket/sync.ts');
      expect(syncFile).toBeDefined();
    });

    it('should not include sync server when disabled', () => {
      const result = generateDeployFiles({ ...baseConfig, includeSyncServer: false });
      const syncFile = result.files.find((f) => f.path === 'api/pocket/sync.ts');
      expect(syncFile).toBeUndefined();
    });

    it('should generate env example', () => {
      const result = generateDeployFiles(baseConfig);
      const envFile = result.files.find((f) => f.path === '.env.example');
      expect(envFile).toBeDefined();
      expect(envFile?.content).toContain('POCKET_DB_NAME');
    });
  });

  describe('Netlify', () => {
    it('should generate netlify.toml', () => {
      const result = generateDeployFiles({ ...baseConfig, platform: 'netlify' });
      const toml = result.files.find((f) => f.path === 'netlify.toml');
      expect(toml).toBeDefined();
      expect(toml?.content).toContain('[build]');
    });

    it('should include sync function when enabled', () => {
      const result = generateDeployFiles({ ...baseConfig, platform: 'netlify' });
      const fn = result.files.find((f) => f.path === 'netlify/functions/pocket-sync.ts');
      expect(fn).toBeDefined();
    });
  });

  describe('Railway', () => {
    it('should generate railway.toml and Procfile', () => {
      const result = generateDeployFiles({ ...baseConfig, platform: 'railway' });
      expect(result.files.find((f) => f.path === 'railway.toml')).toBeDefined();
      expect(result.files.find((f) => f.path === 'Procfile')).toBeDefined();
    });
  });

  describe('Docker', () => {
    it('should generate Dockerfile with multi-stage build', () => {
      const result = generateDeployFiles({ ...baseConfig, platform: 'docker' });
      const dockerfile = result.files.find((f) => f.path === 'Dockerfile');
      expect(dockerfile).toBeDefined();
      expect(dockerfile?.content).toContain('FROM node:20-alpine');
    });

    it('should generate docker-compose.yml', () => {
      const result = generateDeployFiles({ ...baseConfig, platform: 'docker' });
      const compose = result.files.find((f) => f.path === 'docker-compose.yml');
      expect(compose).toBeDefined();
      expect(compose?.content).toContain('services');
    });
  });
});

describe('getSupportedPlatforms', () => {
  it('should return 4 platforms', () => {
    expect(getSupportedPlatforms()).toHaveLength(4);
  });
});

describe('getSupportedFrameworks', () => {
  it('should return 5 frameworks', () => {
    expect(getSupportedFrameworks()).toHaveLength(5);
  });
});
