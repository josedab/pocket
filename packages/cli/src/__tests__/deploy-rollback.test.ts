import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordDeployment,
  getDeploymentHistory,
  rollback,
  clearDeploymentHistory,
} from '../commands/deploy/rollback.js';

describe('deploy rollback', () => {
  beforeEach(() => {
    clearDeploymentHistory('cloudflare');
    clearDeploymentHistory('vercel');
    clearDeploymentHistory('deno');
    clearDeploymentHistory('fly');
  });

  describe('recordDeployment', () => {
    it('records a deployment', () => {
      const record = recordDeployment({
        target: 'cloudflare',
        version: '1.0.0',
        commitSha: 'abc1234',
      });

      expect(record.id).toBeTypeOf('string');
      expect(record.id).toMatch(/^deploy-/);
      expect(record.target).toBe('cloudflare');
      expect(record.version).toBe('1.0.0');
      expect(record.commitSha).toBe('abc1234');
      expect(record.projectName).toBe('pocket-app');
      expect(record.deployedAt).toBeTruthy();
      expect(record.metadata).toEqual({});
    });

    it('uses default values for optional fields', () => {
      const record = recordDeployment({
        target: 'vercel',
        version: '2.0.0',
      });

      expect(record.commitSha).toBe('unknown');
      expect(record.projectName).toBe('pocket-app');
    });

    it('stores metadata', () => {
      const record = recordDeployment({
        target: 'deno',
        version: '1.0.0',
        metadata: { env: 'production', region: 'us-east-1' },
      });

      expect(record.metadata).toEqual({ env: 'production', region: 'us-east-1' });
    });
  });

  describe('getDeploymentHistory', () => {
    it('returns deployment history', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0' });
      recordDeployment({ target: 'cloudflare', version: '1.1.0' });
      recordDeployment({ target: 'cloudflare', version: '1.2.0' });

      const history = getDeploymentHistory('cloudflare');
      expect(history).toHaveLength(3);
      // Newest first
      expect(history[0]!.version).toBe('1.2.0');
      expect(history[2]!.version).toBe('1.0.0');
    });

    it('returns history with limit', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0' });
      recordDeployment({ target: 'cloudflare', version: '1.1.0' });
      recordDeployment({ target: 'cloudflare', version: '1.2.0' });

      const history = getDeploymentHistory('cloudflare', undefined, 2);
      expect(history).toHaveLength(2);
      expect(history[0]!.version).toBe('1.2.0');
    });

    it('returns empty array when no history exists', () => {
      const history = getDeploymentHistory('fly');
      expect(history).toEqual([]);
    });

    it('scopes history by target and project', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0' });
      recordDeployment({ target: 'vercel', version: '2.0.0' });

      const cfHistory = getDeploymentHistory('cloudflare');
      expect(cfHistory).toHaveLength(1);
      expect(cfHistory[0]!.version).toBe('1.0.0');
    });
  });

  describe('rollback', () => {
    it('creates a rollback result', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0', commitSha: 'aaa' });
      recordDeployment({ target: 'cloudflare', version: '1.1.0', commitSha: 'bbb' });

      const result = rollback({ target: 'cloudflare', toVersion: '1.0.0' });

      expect(result.success).toBe(true);
      expect(result.rollbackTo.version).toBe('1.0.0');
      expect(result.current).toBeDefined();
      expect(result.current!.version).toBe('1.1.0');
      expect(result.script).toContain('wrangler deploy');
      expect(result.script).toContain('aaa');
      expect(result.diff.length).toBeGreaterThan(0);
    });

    it('rolls back to previous deployment by default', () => {
      recordDeployment({ target: 'vercel', version: '1.0.0', commitSha: 'aaa' });
      recordDeployment({ target: 'vercel', version: '2.0.0', commitSha: 'bbb' });

      const result = rollback({ target: 'vercel' });

      expect(result.success).toBe(true);
      expect(result.rollbackTo.version).toBe('1.0.0');
      expect(result.script).toContain('vercel deploy --prod');
    });

    it('generates platform-specific scripts', () => {
      recordDeployment({ target: 'fly', version: '1.0.0', commitSha: 'aaa' });
      recordDeployment({ target: 'fly', version: '2.0.0', commitSha: 'bbb' });

      const result = rollback({ target: 'fly', toVersion: '1.0.0' });
      expect(result.script).toContain('fly deploy');
    });

    it('throws when no deployment history exists', () => {
      expect(() => rollback({ target: 'deno' })).toThrow('No deployment history found');
    });

    it('throws when version is not found', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0' });

      expect(() =>
        rollback({ target: 'cloudflare', toVersion: '9.9.9' }),
      ).toThrow('Version not found in history');
    });

    it('throws when not enough history to roll back by default', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0' });

      expect(() => rollback({ target: 'cloudflare' })).toThrow(
        'Not enough deployment history',
      );
    });

    it('includes safety check warnings', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0', commitSha: 'aaa' });
      recordDeployment({ target: 'cloudflare', version: '1.0.0', commitSha: 'aaa' });

      const result = rollback({ target: 'cloudflare', safetyChecks: true });
      expect(result.warnings.some((w) => w.includes('identical'))).toBe(true);
    });
  });

  describe('clearDeploymentHistory', () => {
    it('clears deployment records', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0' });
      recordDeployment({ target: 'cloudflare', version: '1.1.0' });

      clearDeploymentHistory('cloudflare');

      const history = getDeploymentHistory('cloudflare');
      expect(history).toHaveLength(0);
    });

    it('only clears specified target', () => {
      recordDeployment({ target: 'cloudflare', version: '1.0.0' });
      recordDeployment({ target: 'vercel', version: '2.0.0' });

      clearDeploymentHistory('cloudflare');

      expect(getDeploymentHistory('cloudflare')).toHaveLength(0);
      expect(getDeploymentHistory('vercel')).toHaveLength(1);
    });
  });
});
