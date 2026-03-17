import { describe, expect, it } from 'vitest';
import { createMergeResolver } from '../merge-resolver.js';
import type { MergeConflict } from '../types.js';

function makeConflict(overrides: Partial<MergeConflict> = {}): MergeConflict {
  return {
    path: ['field'],
    localValue: 'local',
    remoteValue: 'remote',
    resolvedValue: 'remote',
    winner: 'remote-actor',
    ...overrides,
  };
}

describe('createMergeResolver', () => {
  describe('last-writer-wins strategy', () => {
    const resolver = createMergeResolver({ defaultStrategy: 'last-writer-wins' });

    it('should return resolvedValue for string conflict', () => {
      const c = makeConflict({ resolvedValue: 'winner-value' });
      expect(resolver.resolve(c)).toBe('winner-value');
    });

    it('should return resolvedValue for number conflict', () => {
      const c = makeConflict({ localValue: 1, remoteValue: 2, resolvedValue: 2 });
      expect(resolver.resolve(c)).toBe(2);
    });

    it('should return resolvedValue for null', () => {
      const c = makeConflict({ resolvedValue: null });
      expect(resolver.resolve(c)).toBeNull();
    });

    it('should return resolvedValue for object', () => {
      const obj = { a: 1 };
      const c = makeConflict({ resolvedValue: obj });
      expect(resolver.resolve(c)).toBe(obj);
    });
  });

  describe('field-level-merge strategy', () => {
    const resolver = createMergeResolver({ defaultStrategy: 'field-level-merge' });

    it('should merge two objects by combining their fields', () => {
      const c = makeConflict({
        localValue: { a: 1, b: 2 },
        remoteValue: { c: 3, d: 4 },
        resolvedValue: { c: 3, d: 4 },
      });
      expect(resolver.resolve(c)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
    });

    it('should let remote fields overwrite local fields on overlap', () => {
      const c = makeConflict({
        localValue: { a: 1, shared: 'local' },
        remoteValue: { b: 2, shared: 'remote' },
      });
      const result = resolver.resolve(c) as Record<string, unknown>;
      expect(result.a).toBe(1);
      expect(result.b).toBe(2);
      expect(result.shared).toBe('remote');
    });

    it('should fall back to resolvedValue when localValue is not an object', () => {
      const c = makeConflict({
        localValue: 'string',
        remoteValue: { a: 1 },
        resolvedValue: 'fallback',
      });
      expect(resolver.resolve(c)).toBe('fallback');
    });

    it('should fall back to resolvedValue when remoteValue is not an object', () => {
      const c = makeConflict({
        localValue: { a: 1 },
        remoteValue: 42,
        resolvedValue: 'fallback',
      });
      expect(resolver.resolve(c)).toBe('fallback');
    });

    it('should fall back when localValue is null', () => {
      const c = makeConflict({
        localValue: null,
        remoteValue: { a: 1 },
        resolvedValue: 'fallback',
      });
      expect(resolver.resolve(c)).toBe('fallback');
    });

    it('should fall back when remoteValue is null', () => {
      const c = makeConflict({
        localValue: { a: 1 },
        remoteValue: null,
        resolvedValue: 'fallback',
      });
      expect(resolver.resolve(c)).toBe('fallback');
    });
  });

  describe('auto strategy', () => {
    const resolver = createMergeResolver({ defaultStrategy: 'auto' });

    it('should sum conflicting numbers', () => {
      const c = makeConflict({ localValue: 5, remoteValue: 3 });
      expect(resolver.resolve(c)).toBe(8);
    });

    it('should sum negative numbers', () => {
      const c = makeConflict({ localValue: -2, remoteValue: 7 });
      expect(resolver.resolve(c)).toBe(5);
    });

    it('should sum zeroes', () => {
      const c = makeConflict({ localValue: 0, remoteValue: 0 });
      expect(resolver.resolve(c)).toBe(0);
    });

    it('should pick the longer string', () => {
      const c = makeConflict({ localValue: 'short', remoteValue: 'a longer string' });
      expect(resolver.resolve(c)).toBe('a longer string');
    });

    it('should pick local string when equal length', () => {
      const c = makeConflict({ localValue: 'abc', remoteValue: 'xyz' });
      expect(resolver.resolve(c)).toBe('abc');
    });

    it('should handle empty strings', () => {
      const c = makeConflict({ localValue: '', remoteValue: 'content' });
      expect(resolver.resolve(c)).toBe('content');
    });

    it('should union arrays (deduplicating)', () => {
      const c = makeConflict({
        localValue: [1, 2, 3],
        remoteValue: [2, 3, 4, 5],
      });
      expect(resolver.resolve(c)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle empty arrays', () => {
      const c = makeConflict({ localValue: [], remoteValue: [1] });
      expect(resolver.resolve(c)).toEqual([1]);
    });

    it('should fall back to resolvedValue for mixed types', () => {
      const c = makeConflict({
        localValue: 'string',
        remoteValue: 42,
        resolvedValue: 'fallback',
      });
      expect(resolver.resolve(c)).toBe('fallback');
    });

    it('should fall back for boolean conflicts', () => {
      const c = makeConflict({
        localValue: true,
        remoteValue: false,
        resolvedValue: true,
      });
      expect(resolver.resolve(c)).toBe(true);
    });

    it('should fall back for object conflicts', () => {
      const c = makeConflict({
        localValue: { a: 1 },
        remoteValue: { b: 2 },
        resolvedValue: 'resolved',
      });
      expect(resolver.resolve(c)).toBe('resolved');
    });
  });

  describe('custom strategy', () => {
    it('should invoke custom resolver', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'custom',
        customResolver: (c) => `${String(c.localValue)}-${String(c.remoteValue)}`,
      });
      const c = makeConflict({ localValue: 'a', remoteValue: 'b' });
      expect(resolver.resolve(c)).toBe('a-b');
    });

    it('should fall back to resolvedValue when no custom resolver provided', () => {
      const resolver = createMergeResolver({ defaultStrategy: 'custom' });
      const c = makeConflict({ resolvedValue: 'default' });
      expect(resolver.resolve(c)).toBe('default');
    });

    it('should pass the full conflict to the custom resolver', () => {
      let captured: MergeConflict | null = null;
      const resolver = createMergeResolver({
        defaultStrategy: 'custom',
        customResolver: (c) => {
          captured = c;
          return c.resolvedValue;
        },
      });
      const c = makeConflict({ path: ['deep', 'path'], localValue: 1, remoteValue: 2 });
      resolver.resolve(c);
      expect(captured).toBe(c);
    });
  });

  describe('getStrategy', () => {
    it('should return default strategy for unconfigured paths', () => {
      const resolver = createMergeResolver({ defaultStrategy: 'last-writer-wins' });
      expect(resolver.getStrategy(['anything'])).toBe('last-writer-wins');
    });

    it('should return exact match field strategy', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'last-writer-wins',
        fieldStrategies: { title: 'auto', 'meta.tags': 'field-level-merge' },
      });
      expect(resolver.getStrategy(['title'])).toBe('auto');
      expect(resolver.getStrategy(['meta', 'tags'])).toBe('field-level-merge');
    });

    it('should match prefix paths', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'last-writer-wins',
        fieldStrategies: { meta: 'field-level-merge' },
      });
      // 'meta.anything' starts with 'meta', so it should match
      expect(resolver.getStrategy(['meta', 'anything'])).toBe('field-level-merge');
    });

    it('should handle numeric path segments', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'auto',
        fieldStrategies: { 'items.0': 'last-writer-wins' },
      });
      expect(resolver.getStrategy(['items', 0])).toBe('last-writer-wins');
    });
  });

  describe('resolveAll', () => {
    it('should resolve multiple conflicts and return pairs', () => {
      const resolver = createMergeResolver({ defaultStrategy: 'last-writer-wins' });
      const conflicts: MergeConflict[] = [
        makeConflict({ path: ['a'], resolvedValue: 'v1' }),
        makeConflict({ path: ['b'], resolvedValue: 'v2' }),
        makeConflict({ path: ['c'], resolvedValue: 'v3' }),
      ];

      const results = resolver.resolveAll(conflicts);
      expect(results).toHaveLength(3);
      expect(results[0]!.resolvedValue).toBe('v1');
      expect(results[1]!.resolvedValue).toBe('v2');
      expect(results[2]!.resolvedValue).toBe('v3');
      expect(results[0]!.conflict).toBe(conflicts[0]);
    });

    it('should handle empty conflicts array', () => {
      const resolver = createMergeResolver({ defaultStrategy: 'auto' });
      expect(resolver.resolveAll([])).toHaveLength(0);
    });

    it('should use per-field strategies in resolveAll', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'last-writer-wins',
        fieldStrategies: { count: 'auto' },
      });
      const conflicts: MergeConflict[] = [
        makeConflict({ path: ['count'], localValue: 5, remoteValue: 3, resolvedValue: 3 }),
        makeConflict({ path: ['name'], localValue: 'a', remoteValue: 'b', resolvedValue: 'b' }),
      ];
      const results = resolver.resolveAll(conflicts);
      // 'count' uses auto → sums numbers
      expect(results[0]!.resolvedValue).toBe(8);
      // 'name' uses last-writer-wins → resolvedValue
      expect(results[1]!.resolvedValue).toBe('b');
    });
  });

  describe('unknown strategy fallback', () => {
    it('should return resolvedValue for unknown strategy', () => {
      const resolver = createMergeResolver({
        defaultStrategy: 'something-unknown' as 'auto',
      });
      const c = makeConflict({ resolvedValue: 'fallback' });
      expect(resolver.resolve(c)).toBe('fallback');
    });
  });
});
