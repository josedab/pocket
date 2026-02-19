import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { createMaterializedViewManager } from '../materialized-view-manager.js';
import type {
  MaterializedViewManager,
  ViewDefinition,
} from '../materialized-view-manager.js';

describe('MaterializedViewManager', () => {
  let manager: MaterializedViewManager;

  beforeEach(() => {
    manager = createMaterializedViewManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  // ---- create / drop views ------------------------------------------------

  describe('create and drop views', () => {
    it('should create a named view', () => {
      const view = manager.createView('users', { collection: 'users' });
      expect(view.name).toBe('users');
      expect(manager.getViewNames()).toContain('users');
    });

    it('should drop a view', () => {
      manager.createView('users', { collection: 'users' });
      manager.dropView('users');
      expect(manager.getViewNames()).not.toContain('users');
    });

    it('should throw when creating a duplicate view', () => {
      manager.createView('users', { collection: 'users' });
      expect(() => manager.createView('users', { collection: 'users' })).toThrow(
        'already exists',
      );
    });

    it('should return undefined for unknown view', () => {
      expect(manager.getView('nope')).toBeUndefined();
    });
  });

  // ---- result$ observable --------------------------------------------------

  describe('view result observable', () => {
    it('should emit initial empty result', async () => {
      const view = manager.createView('items', { collection: 'items' });
      const snapshot = view.getSnapshot();
      expect(snapshot.rows).toEqual([]);
    });

    it('should emit updated result after change', async () => {
      const view = manager.createView('items', {
        collection: 'items',
        aggregation: { function: 'count' },
      });

      manager.handleChange('items', '1', 'create', { _id: '1', value: 10 });

      const result = view.getSnapshot();
      expect(result.rows).toHaveLength(1);
      expect(result.aggregation).toBe(1);
    });
  });

  // ---- handleChange (create / update / delete) -----------------------------

  describe('handle document changes', () => {
    it('should handle create', () => {
      const view = manager.createView('orders', {
        collection: 'orders',
        aggregation: { function: 'sum', field: 'amount' },
      });

      manager.handleChange('orders', 'o1', 'create', { amount: 50 });
      manager.handleChange('orders', 'o2', 'create', { amount: 30 });

      const snap = view.getSnapshot();
      expect(snap.rows).toHaveLength(2);
      expect(snap.aggregation).toBe(80);
    });

    it('should handle update', () => {
      const view = manager.createView('orders', {
        collection: 'orders',
        aggregation: { function: 'sum', field: 'amount' },
      });

      manager.handleChange('orders', 'o1', 'create', { amount: 50 });
      manager.handleChange('orders', 'o1', 'update', { amount: 75 });

      expect(view.getSnapshot().aggregation).toBe(75);
    });

    it('should handle delete', () => {
      const view = manager.createView('orders', {
        collection: 'orders',
        aggregation: { function: 'count' },
      });

      manager.handleChange('orders', 'o1', 'create', { amount: 50 });
      manager.handleChange('orders', 'o1', 'delete');

      expect(view.getSnapshot().rows).toHaveLength(0);
      expect(view.getSnapshot().aggregation).toBe(0);
    });

    it('should ignore changes for unrelated collections', () => {
      const view = manager.createView('orders', {
        collection: 'orders',
        aggregation: { function: 'count' },
      });

      manager.handleChange('users', 'u1', 'create', { name: 'Alice' });

      expect(view.getSnapshot().rows).toHaveLength(0);
    });
  });

  // ---- refreshAll ----------------------------------------------------------

  describe('refreshAll', () => {
    it('should refresh every view', () => {
      const v1 = manager.createView('a', { collection: 'a' });
      const v2 = manager.createView('b', { collection: 'b' });

      manager.refreshAll();

      // After refresh, updatedAt should be a recent timestamp
      expect(v1.getSnapshot().updatedAt).toBeGreaterThan(0);
      expect(v2.getSnapshot().updatedAt).toBeGreaterThan(0);
      expect(manager.getStats().totalRefreshes).toBe(2);
    });
  });

  // ---- stats ---------------------------------------------------------------

  describe('stats tracking', () => {
    it('should track view count and changes', () => {
      manager.createView('x', { collection: 'x' });
      manager.handleChange('x', '1', 'create', { v: 1 });
      manager.handleChange('x', '2', 'create', { v: 2 });

      const stats = manager.getStats();
      expect(stats.totalViews).toBe(1);
      expect(stats.totalChangesProcessed).toBe(2);
    });

    it('should track refreshes', () => {
      manager.createView('y', { collection: 'y' });
      const view = manager.getView('y')!;
      view.refresh();
      view.refresh();

      expect(manager.getStats().totalRefreshes).toBe(2);
    });
  });

  // ---- maxViews limit ------------------------------------------------------

  describe('max views limit', () => {
    it('should enforce maxViews', () => {
      const limited = createMaterializedViewManager({ maxViews: 2 });
      limited.createView('a', { collection: 'a' });
      limited.createView('b', { collection: 'b' });

      expect(() => limited.createView('c', { collection: 'c' })).toThrow(
        'Maximum number of views',
      );

      limited.destroy();
    });
  });
});
