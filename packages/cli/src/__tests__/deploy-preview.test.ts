import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPreview,
  listPreviews,
  getPreview,
  deletePreview,
  cleanupPreviews,
  comparePreviews,
} from '../commands/deploy/preview.js';

describe('deploy preview', () => {
  beforeEach(() => {
    // Clean up all previews between tests
    // Create and delete to clear, then cleanup removes them
    const all = listPreviews();
    for (const p of all) {
      deletePreview(p.id);
    }
    cleanupPreviews();
  });

  describe('createPreview', () => {
    it('creates a preview deployment', () => {
      const preview = createPreview({
        target: 'cloudflare',
        projectName: 'my-app',
        branch: 'feat/sync',
        commitSha: 'abc1234',
      });

      expect(preview.id).toBeTypeOf('string');
      expect(preview.id).toHaveLength(8);
      expect(preview.url).toContain('my-app');
      expect(preview.url).toContain('workers.dev');
      expect(preview.target).toBe('cloudflare');
      expect(preview.projectName).toBe('my-app');
      expect(preview.branch).toBe('feat/sync');
      expect(preview.commitSha).toBe('abc1234');
      expect(preview.status).toBe('active');
      expect(preview.createdAt).toBeTruthy();
      expect(preview.expiresAt).toBeTruthy();
    });

    it('uses default values when optional fields are omitted', () => {
      const preview = createPreview({ target: 'vercel' });

      expect(preview.projectName).toBe('pocket-app');
      expect(preview.branch).toBe('main');
      expect(preview.commitSha).toBe('unknown');
      expect(preview.label).toContain('preview-');
    });

    it('generates platform-specific URLs', () => {
      const cf = createPreview({ target: 'cloudflare', projectName: 'app' });
      expect(cf.url).toContain('workers.dev');

      const deno = createPreview({ target: 'deno', projectName: 'app' });
      expect(deno.url).toContain('deno.dev');

      const vercel = createPreview({ target: 'vercel', projectName: 'app' });
      expect(vercel.url).toContain('vercel.app');

      const fly = createPreview({ target: 'fly', projectName: 'app' });
      expect(fly.url).toContain('fly.dev');
    });
  });

  describe('listPreviews', () => {
    it('returns all previews', () => {
      createPreview({ target: 'cloudflare', projectName: 'app1' });
      createPreview({ target: 'vercel', projectName: 'app2' });

      const all = listPreviews();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by status', () => {
      const p1 = createPreview({ target: 'cloudflare', projectName: 'app1' });
      createPreview({ target: 'vercel', projectName: 'app2' });

      deletePreview(p1.id);

      const deleted = listPreviews('deleted');
      expect(deleted.length).toBeGreaterThanOrEqual(1);
      expect(deleted.every((p) => p.status === 'deleted')).toBe(true);

      const active = listPreviews('active');
      expect(active.every((p) => p.status === 'active')).toBe(true);
    });
  });

  describe('getPreview', () => {
    it('retrieves a preview by ID', () => {
      const created = createPreview({
        target: 'deno',
        projectName: 'my-deno-app',
        branch: 'main',
      });

      const fetched = getPreview(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.projectName).toBe('my-deno-app');
    });

    it('returns undefined for non-existent ID', () => {
      expect(getPreview('nonexistent')).toBeUndefined();
    });
  });

  describe('deletePreview', () => {
    it('removes a preview by marking it as deleted', () => {
      const preview = createPreview({ target: 'fly', projectName: 'app' });
      const result = deletePreview(preview.id);

      expect(result).toBe(true);

      const fetched = getPreview(preview.id);
      expect(fetched!.status).toBe('deleted');
    });

    it('returns false for non-existent preview', () => {
      expect(deletePreview('nonexistent')).toBe(false);
    });
  });

  describe('cleanupPreviews', () => {
    it('removes expired and deleted previews', () => {
      const p1 = createPreview({ target: 'cloudflare', projectName: 'app' });
      createPreview({ target: 'vercel', projectName: 'app2' });

      deletePreview(p1.id);

      const cleaned = cleanupPreviews();
      expect(cleaned).toBeGreaterThanOrEqual(1);

      // Deleted preview should no longer be retrievable
      expect(getPreview(p1.id)).toBeUndefined();
    });
  });

  describe('comparePreviews', () => {
    it('compares two preview deployments', () => {
      const p1 = createPreview({
        target: 'cloudflare',
        projectName: 'app',
        branch: 'main',
        commitSha: 'aaa111',
      });
      const p2 = createPreview({
        target: 'vercel',
        projectName: 'app',
        branch: 'feat/new',
        commitSha: 'bbb222',
      });

      const comparison = comparePreviews(p1.id, p2.id);

      expect(comparison.source.id).toBe(p1.id);
      expect(comparison.target.id).toBe(p2.id);
      expect(comparison.differences.length).toBeGreaterThan(0);

      const targetDiff = comparison.differences.find((d) => d.category === 'target');
      expect(targetDiff).toBeDefined();
      expect(targetDiff!.description).toContain('cloudflare');
      expect(targetDiff!.description).toContain('vercel');
    });

    it('returns empty differences for identical configs', () => {
      const p1 = createPreview({
        target: 'cloudflare',
        projectName: 'app',
        branch: 'main',
        commitSha: 'aaa111',
      });
      const p2 = createPreview({
        target: 'cloudflare',
        projectName: 'app',
        branch: 'main',
        commitSha: 'aaa111',
      });

      const comparison = comparePreviews(p1.id, p2.id);
      expect(comparison.differences).toHaveLength(0);
    });

    it('throws for non-existent source', () => {
      const p = createPreview({ target: 'cloudflare' });
      expect(() => comparePreviews('nonexistent', p.id)).toThrow('Preview not found');
    });

    it('throws for non-existent target', () => {
      const p = createPreview({ target: 'cloudflare' });
      expect(() => comparePreviews(p.id, 'nonexistent')).toThrow('Preview not found');
    });
  });
});
