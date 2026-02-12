import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  FilteredSearch,
  createFilteredSearch,
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  inFilter,
  ninFilter,
  and,
  or,
  not,
} from '../filtered-search.js';
import { createVectorStore, VectorStore } from '../vector-store.js';
import type { Vector } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DIMS = 4;

function vec(...values: number[]): Vector {
  return values;
}

async function seedStore(store: VectorStore) {
  await store.upsert('a', vec(1, 0, 0, 0), { category: 'tech', year: 2023, active: true });
  await store.upsert('b', vec(0, 1, 0, 0), { category: 'science', year: 2022, active: false });
  await store.upsert('c', vec(0, 0, 1, 0), { category: 'tech', year: 2024, active: true });
  await store.upsert('d', vec(0, 0, 0, 1), { category: 'art', year: 2021, active: false });
}

/* ================================================================== */
/*  FilteredSearch                                                      */
/* ================================================================== */

describe('FilteredSearch', () => {
  let store: VectorStore;
  let search: FilteredSearch;

  beforeEach(async () => {
    store = createVectorStore({ name: 'test-filtered', dimensions: DIMS });
    await seedStore(store);
    search = createFilteredSearch(store);
    search.indexMetadata('category', 'string');
    search.indexMetadata('year', 'number');
    search.indexMetadata('active', 'boolean');
    search.rebuildMetadataIndex();
  });

  afterEach(() => {
    search.destroy();
    store.dispose();
  });

  describe('createFilteredSearch', () => {
    it('should create instance via factory', () => {
      expect(search).toBeInstanceOf(FilteredSearch);
    });
  });

  describe('indexMetadata', () => {
    it('should register metadata fields for indexing', () => {
      // If indexing works, a rebuild followed by an eq search should succeed
      const fresh = createFilteredSearch(store);
      fresh.indexMetadata('category', 'string');
      fresh.rebuildMetadataIndex();
      fresh.destroy();
    });
  });

  describe('search – no filter', () => {
    it('should return results when no filter is provided', async () => {
      const results = await search.search(vec(1, 0, 0, 0), { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should respect limit', async () => {
      const results = await search.search(vec(1, 0, 0, 0), { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('search – eq filter', () => {
    it('should return only matching entries', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        eq('category', 'tech')
      );
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.metadata?.category).toBe('tech');
      }
    });
  });

  describe('search – gt/lt filters', () => {
    it('should filter with gt', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        gt('year', 2022)
      );
      for (const r of results) {
        expect(r.metadata?.year).toBeGreaterThan(2022);
      }
    });

    it('should filter with lt', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        lt('year', 2023)
      );
      for (const r of results) {
        expect(r.metadata?.year).toBeLessThan(2023);
      }
    });

    it('should filter with gte', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        gte('year', 2023)
      );
      for (const r of results) {
        expect(r.metadata?.year).toBeGreaterThanOrEqual(2023);
      }
    });

    it('should filter with lte', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        lte('year', 2022)
      );
      for (const r of results) {
        expect(r.metadata?.year).toBeLessThanOrEqual(2022);
      }
    });
  });

  describe('search – composite filters', () => {
    it('should filter with and', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        and(eq('category', 'tech'), gte('year', 2024))
      );
      expect(results.length).toBe(1);
      expect(results[0]!.metadata?.category).toBe('tech');
      expect(results[0]!.metadata?.year).toBe(2024);
    });

    it('should filter with or', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        or(eq('category', 'tech'), eq('category', 'art'))
      );
      expect(results.length).toBe(3);
      for (const r of results) {
        expect(['tech', 'art']).toContain(r.metadata?.category);
      }
    });
  });

  describe('search – not filter', () => {
    it('should negate a filter', async () => {
      const results = await search.search(
        vec(1, 0, 0, 0),
        { limit: 10, strategy: 'pre' },
        not(eq('category', 'tech'))
      );
      for (const r of results) {
        expect(r.metadata?.category).not.toBe('tech');
      }
      expect(results.length).toBe(2);
    });
  });

  describe('evaluateFilter', () => {
    const metadata = { category: 'tech', year: 2023, active: true };

    it('should evaluate eq', () => {
      expect(search.evaluateFilter(metadata, eq('category', 'tech'))).toBe(true);
      expect(search.evaluateFilter(metadata, eq('category', 'art'))).toBe(false);
    });

    it('should evaluate neq', () => {
      expect(search.evaluateFilter(metadata, neq('category', 'art'))).toBe(true);
      expect(search.evaluateFilter(metadata, neq('category', 'tech'))).toBe(false);
    });

    it('should evaluate gt', () => {
      expect(search.evaluateFilter(metadata, gt('year', 2022))).toBe(true);
      expect(search.evaluateFilter(metadata, gt('year', 2023))).toBe(false);
    });

    it('should evaluate gte', () => {
      expect(search.evaluateFilter(metadata, gte('year', 2023))).toBe(true);
      expect(search.evaluateFilter(metadata, gte('year', 2024))).toBe(false);
    });

    it('should evaluate lt', () => {
      expect(search.evaluateFilter(metadata, lt('year', 2024))).toBe(true);
      expect(search.evaluateFilter(metadata, lt('year', 2023))).toBe(false);
    });

    it('should evaluate lte', () => {
      expect(search.evaluateFilter(metadata, lte('year', 2023))).toBe(true);
      expect(search.evaluateFilter(metadata, lte('year', 2022))).toBe(false);
    });

    it('should evaluate inFilter', () => {
      expect(search.evaluateFilter(metadata, inFilter('category', ['tech', 'science']))).toBe(true);
      expect(search.evaluateFilter(metadata, inFilter('category', ['art']))).toBe(false);
    });

    it('should evaluate ninFilter', () => {
      expect(search.evaluateFilter(metadata, ninFilter('category', ['art']))).toBe(true);
      expect(search.evaluateFilter(metadata, ninFilter('category', ['tech']))).toBe(false);
    });

    it('should evaluate and', () => {
      expect(
        search.evaluateFilter(metadata, and(eq('category', 'tech'), gte('year', 2023)))
      ).toBe(true);
      expect(
        search.evaluateFilter(metadata, and(eq('category', 'tech'), gt('year', 2023)))
      ).toBe(false);
    });

    it('should evaluate or', () => {
      expect(
        search.evaluateFilter(metadata, or(eq('category', 'art'), eq('active', true)))
      ).toBe(true);
      expect(
        search.evaluateFilter(metadata, or(eq('category', 'art'), eq('active', false)))
      ).toBe(false);
    });

    it('should evaluate not', () => {
      expect(search.evaluateFilter(metadata, not(eq('category', 'art')))).toBe(true);
      expect(search.evaluateFilter(metadata, not(eq('category', 'tech')))).toBe(false);
    });
  });

  describe('filter helper functions', () => {
    it('eq creates comparison filter', () => {
      const f = eq('field', 'value');
      expect(f).toEqual({ type: 'comparison', field: 'field', operator: 'eq', value: 'value' });
    });

    it('neq creates comparison filter', () => {
      const f = neq('field', 'value');
      expect(f).toEqual({ type: 'comparison', field: 'field', operator: 'neq', value: 'value' });
    });

    it('gt creates comparison filter', () => {
      const f = gt('field', 5);
      expect(f).toEqual({ type: 'comparison', field: 'field', operator: 'gt', value: 5 });
    });

    it('gte creates comparison filter', () => {
      const f = gte('field', 5);
      expect(f).toEqual({ type: 'comparison', field: 'field', operator: 'gte', value: 5 });
    });

    it('lt creates comparison filter', () => {
      const f = lt('field', 5);
      expect(f).toEqual({ type: 'comparison', field: 'field', operator: 'lt', value: 5 });
    });

    it('lte creates comparison filter', () => {
      const f = lte('field', 5);
      expect(f).toEqual({ type: 'comparison', field: 'field', operator: 'lte', value: 5 });
    });

    it('inFilter creates comparison filter', () => {
      const f = inFilter('field', [1, 2]);
      expect(f).toEqual({ type: 'comparison', field: 'field', operator: 'in', value: [1, 2] });
    });

    it('and creates logical filter', () => {
      const f = and(eq('a', 1), eq('b', 2));
      expect(f.type).toBe('logical');
      expect(f.operator).toBe('and');
      expect(f.filters.length).toBe(2);
    });

    it('or creates logical filter', () => {
      const f = or(eq('a', 1), eq('b', 2));
      expect(f.type).toBe('logical');
      expect(f.operator).toBe('or');
      expect(f.filters.length).toBe(2);
    });

    it('not creates logical filter with single child', () => {
      const f = not(eq('a', 1));
      expect(f.type).toBe('logical');
      expect(f.operator).toBe('not');
      expect(f.filters.length).toBe(1);
    });
  });

  describe('rebuildMetadataIndex', () => {
    it('should rebuild index from store entries', async () => {
      await store.upsert('e', vec(0.5, 0.5, 0, 0), { category: 'new', year: 2025 });
      search.rebuildMetadataIndex();

      const results = await search.search(
        vec(0.5, 0.5, 0, 0),
        { limit: 10, strategy: 'pre' },
        eq('category', 'new')
      );
      expect(results.length).toBe(1);
      expect(results[0]!.id).toBe('e');
    });
  });

  describe('destroy', () => {
    it('should clean up without errors', () => {
      const s = createFilteredSearch(store);
      s.indexMetadata('category', 'string');
      s.rebuildMetadataIndex();
      expect(() => s.destroy()).not.toThrow();
    });
  });
});
