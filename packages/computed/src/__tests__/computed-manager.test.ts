import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComputedManager, createComputedManager } from '../computed-manager.js';
import { filter } from '../operators.js';
import type { SourceCollection } from '../types.js';

function createMockSource(name: string, data: Record<string, unknown>[]): SourceCollection {
  const subject = new BehaviorSubject<Record<string, unknown>[]>(data);
  return {
    name,
    documents$: subject.asObservable(),
    getAll: () => subject.getValue(),
  };
}

describe('ComputedManager', () => {
  let manager: ComputedManager;

  beforeEach(() => {
    manager = new ComputedManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  it('creates via factory', () => {
    const m = createComputedManager();
    expect(m).toBeInstanceOf(ComputedManager);
    m.dispose();
  });

  describe('registerSource', () => {
    it('registers a source collection', () => {
      const source = createMockSource('users', [{ _id: '1', name: 'Alice' }]);
      manager.registerSource(source);
      expect(manager.getState().sourceCount).toBe(1);
    });

    it('registers multiple sources', () => {
      const users = createMockSource('users', []);
      const orders = createMockSource('orders', []);
      manager.registerSources([users, orders]);
      expect(manager.getState().sourceCount).toBe(2);
    });
  });

  describe('addComputed', () => {
    it('creates a computed collection', () => {
      const users = createMockSource('users', [
        { _id: '1', name: 'Alice', active: true },
        { _id: '2', name: 'Bob', active: false },
      ]);
      manager.registerSource(users);

      const computed = manager.addComputed({
        name: 'active-users',
        sources: ['users'],
        compute: filter('users', (doc) => doc.active === true),
      });

      expect(computed).toBeDefined();
      expect(manager.getComputedNames()).toContain('active-users');
    });

    it('throws on duplicate name', () => {
      const users = createMockSource('users', []);
      manager.registerSource(users);

      manager.addComputed({
        name: 'test',
        sources: ['users'],
        compute: filter('users', () => true),
      });

      expect(() =>
        manager.addComputed({
          name: 'test',
          sources: ['users'],
          compute: filter('users', () => true),
        })
      ).toThrow('already exists');
    });

    it('detects circular dependencies', () => {
      const source = createMockSource('base', []);
      manager.registerSource(source);

      manager.addComputed({
        name: 'a',
        sources: ['base'],
        compute: filter('base', () => true),
      });

      // 'b' depends on 'a'
      manager.addComputed({
        name: 'b',
        sources: ['a'],
        compute: filter('a', () => true),
      });

      // 'c' depends on 'b', trying to add 'a' depending on 'c' would create cycle
      // But the cycle detection happens via topological sort in addComputed
      // Direct cycle test: depends on itself indirectly
      expect(() =>
        manager.addComputed({
          name: 'c',
          sources: ['b', 'c'], // self-dependency
          compute: filter('b', () => true),
        })
      ).toThrow('Circular dependency');
    });
  });

  describe('getComputed', () => {
    it('returns undefined for non-existent', () => {
      expect(manager.getComputed('nope')).toBeUndefined();
    });

    it('returns the computed collection', () => {
      const source = createMockSource('users', []);
      manager.registerSource(source);

      manager.addComputed({
        name: 'test',
        sources: ['users'],
        compute: filter('users', () => true),
      });

      expect(manager.getComputed('test')).toBeDefined();
    });
  });

  describe('removeComputed', () => {
    it('removes a computed collection', () => {
      const source = createMockSource('users', []);
      manager.registerSource(source);

      manager.addComputed({
        name: 'test',
        sources: ['users'],
        compute: filter('users', () => true),
      });

      manager.removeComputed('test');
      expect(manager.getComputedNames()).not.toContain('test');
    });

    it('throws when removing a depended-upon collection', () => {
      const source = createMockSource('base', []);
      manager.registerSource(source);

      manager.addComputed({
        name: 'parent',
        sources: ['base'],
        compute: filter('base', () => true),
      });

      manager.addComputed({
        name: 'child',
        sources: ['parent'],
        compute: filter('parent', () => true),
      });

      expect(() => manager.removeComputed('parent')).toThrow('depended on by');
    });

    it('no-ops for non-existent collection', () => {
      expect(() => manager.removeComputed('nonexistent')).not.toThrow();
    });
  });

  describe('state$', () => {
    it('emits initial state', async () => {
      const { firstValueFrom } = await import('rxjs');
      const state = await firstValueFrom(manager.state$);
      expect(state.collections).toEqual({});
      expect(state.totalComputations).toBe(0);
      expect(state.sourceCount).toBe(0);
    });

    it('updates state when sources added', async () => {
      const { firstValueFrom } = await import('rxjs');
      const source = createMockSource('users', []);
      manager.registerSource(source);

      const state = await firstValueFrom(manager.state$);
      expect(state.sourceCount).toBe(1);
    });
  });

  describe('getComputedNames', () => {
    it('returns empty array initially', () => {
      expect(manager.getComputedNames()).toEqual([]);
    });

    it('returns all computed collection names', () => {
      const source = createMockSource('data', []);
      manager.registerSource(source);

      manager.addComputed({
        name: 'a',
        sources: ['data'],
        compute: filter('data', () => true),
      });
      manager.addComputed({
        name: 'b',
        sources: ['data'],
        compute: filter('data', () => true),
      });

      const names = manager.getComputedNames();
      expect(names).toContain('a');
      expect(names).toContain('b');
      expect(names).toHaveLength(2);
    });
  });

  describe('dispose', () => {
    it('disposes all computed collections', () => {
      const source = createMockSource('data', []);
      manager.registerSource(source);

      manager.addComputed({
        name: 'test',
        sources: ['data'],
        compute: filter('data', () => true),
      });

      manager.dispose();
      expect(manager.getComputedNames()).toHaveLength(0);
    });
  });
});
