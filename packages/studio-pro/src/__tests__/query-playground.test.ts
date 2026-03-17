import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { QueryPlayground } from '../query-playground.js';
import { createProQueryPlayground } from '../query-playground.js';

describe('QueryPlayground', () => {
  let playground: QueryPlayground;

  const docs = [
    { _id: '1', name: 'Alice', age: 30, active: true, score: 90 },
    { _id: '2', name: 'Bob', age: 25, active: false, score: 70 },
    { _id: '3', name: 'Charlie', age: 35, active: true, score: 85 },
    { _id: '4', name: 'Diana', age: 28, active: false, score: 60 },
    { _id: '5', name: 'Eve', age: 40, active: true, score: 95 },
  ];

  beforeEach(() => {
    playground = createProQueryPlayground({ maxHistoryEntries: 50 });
  });

  // ── Basic Execution ───────────────────────────────────────────────

  describe('execute', () => {
    it('should return all documents when no filter is provided', () => {
      const result = playground.execute({ collection: 'users' }, docs);
      expect(result.resultCount).toBe(5);
      expect(result.results).toEqual(docs);
    });

    it('should return empty array for no matches', () => {
      const result = playground.execute(
        { collection: 'users', filter: { name: 'Nonexistent' } },
        docs
      );
      expect(result.resultCount).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should return empty array for empty documents', () => {
      const result = playground.execute({ collection: 'users' }, []);
      expect(result.resultCount).toBe(0);
    });

    it('should include executionTimeMs >= 0', () => {
      const result = playground.execute({ collection: 'users' }, docs);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Equality Filter ───────────────────────────────────────────────

  describe('equality filter', () => {
    it('should filter by string equality', () => {
      const result = playground.execute({ collection: 'users', filter: { name: 'Alice' } }, docs);
      expect(result.resultCount).toBe(1);
      expect((result.results[0] as Record<string, unknown>)['name']).toBe('Alice');
    });

    it('should filter by number equality', () => {
      const result = playground.execute({ collection: 'users', filter: { age: 30 } }, docs);
      expect(result.resultCount).toBe(1);
    });

    it('should filter by boolean equality', () => {
      const result = playground.execute({ collection: 'users', filter: { active: false } }, docs);
      expect(result.resultCount).toBe(2);
    });

    it('should filter by multiple equality conditions (AND)', () => {
      const result = playground.execute(
        { collection: 'users', filter: { active: true, age: 30 } },
        docs
      );
      expect(result.resultCount).toBe(1);
      expect((result.results[0] as Record<string, unknown>)['name']).toBe('Alice');
    });
  });

  // ── Comparison Operators ──────────────────────────────────────────

  describe('comparison operators', () => {
    it('should handle $gt (greater than)', () => {
      const result = playground.execute(
        { collection: 'users', filter: { age: { $gt: 30 } } },
        docs
      );
      expect(
        result.results.every((r) => ((r as Record<string, unknown>)['age'] as number) > 30)
      ).toBe(true);
      expect(result.resultCount).toBe(2); // Charlie 35, Eve 40
    });

    it('should handle $lt (less than)', () => {
      const result = playground.execute(
        { collection: 'users', filter: { age: { $lt: 30 } } },
        docs
      );
      expect(
        result.results.every((r) => ((r as Record<string, unknown>)['age'] as number) < 30)
      ).toBe(true);
      expect(result.resultCount).toBe(2); // Bob 25, Diana 28
    });

    it('should handle $gte (greater than or equal)', () => {
      const result = playground.execute(
        { collection: 'users', filter: { age: { $gte: 35 } } },
        docs
      );
      expect(
        result.results.every((r) => ((r as Record<string, unknown>)['age'] as number) >= 35)
      ).toBe(true);
      expect(result.resultCount).toBe(2); // Charlie 35, Eve 40
    });

    it('should handle $lte (less than or equal)', () => {
      const result = playground.execute(
        { collection: 'users', filter: { age: { $lte: 25 } } },
        docs
      );
      expect(
        result.results.every((r) => ((r as Record<string, unknown>)['age'] as number) <= 25)
      ).toBe(true);
      expect(result.resultCount).toBe(1); // Bob 25
    });

    it('should handle $ne (not equal)', () => {
      const result = playground.execute(
        { collection: 'users', filter: { active: { $ne: true } } },
        docs
      );
      expect(result.resultCount).toBe(2); // Bob, Diana
    });

    it('should combine multiple comparison operators on same field', () => {
      const result = playground.execute(
        { collection: 'users', filter: { age: { $gte: 28, $lte: 35 } } },
        docs
      );
      // Alice 30, Charlie 35, Diana 28
      expect(result.resultCount).toBe(3);
    });

    it('should handle comparison operators on different fields', () => {
      const result = playground.execute(
        { collection: 'users', filter: { age: { $gt: 25 }, score: { $gte: 85 } } },
        docs
      );
      // Alice (30, 90), Charlie (35, 85), Eve (40, 95)
      expect(result.resultCount).toBe(3);
    });

    it('should not match when field does not exist', () => {
      const result = playground.execute(
        { collection: 'users', filter: { nonexistent: { $gt: 0 } } },
        docs
      );
      expect(result.resultCount).toBe(0);
    });

    it('should not match $gt when value is not a number', () => {
      const result = playground.execute(
        { collection: 'users', filter: { name: { $gt: 0 } } },
        docs
      );
      expect(result.resultCount).toBe(0);
    });
  });

  // ── Limit ─────────────────────────────────────────────────────────

  describe('limit', () => {
    it('should limit results to specified count', () => {
      const result = playground.execute({ collection: 'users', limit: 2 }, docs);
      expect(result.resultCount).toBe(2);
    });

    it('should return all if limit exceeds doc count', () => {
      const result = playground.execute({ collection: 'users', limit: 100 }, docs);
      expect(result.resultCount).toBe(5);
    });

    it('should return all if limit is 0', () => {
      const result = playground.execute({ collection: 'users', limit: 0 }, docs);
      // limit: 0 → condition `query.limit > 0` is false, no slicing
      expect(result.resultCount).toBe(5);
    });

    it('should apply limit after filter', () => {
      const result = playground.execute(
        { collection: 'users', filter: { active: true }, limit: 1 },
        docs
      );
      expect(result.resultCount).toBe(1);
      expect((result.results[0] as Record<string, unknown>)['active']).toBe(true);
    });
  });

  // ── History ───────────────────────────────────────────────────────

  describe('history', () => {
    it('should start with empty history', () => {
      expect(playground.getHistory()).toEqual([]);
    });

    it('should record each execution in history', () => {
      playground.execute({ collection: 'users' }, docs);
      playground.execute({ collection: 'users', filter: { active: true } }, docs);
      expect(playground.getHistory().length).toBe(2);
    });

    it('should put most recent entry first (unshift)', () => {
      playground.execute({ collection: 'users' }, docs);
      playground.execute({ collection: 'users', filter: { active: true } }, docs);
      const history = playground.getHistory();
      expect(history[0]!.resultCount).toBe(3); // active filter
      expect(history[1]!.resultCount).toBe(5); // no filter
    });

    it('should assign unique IDs to history entries', () => {
      playground.execute({ collection: 'users' }, docs);
      playground.execute({ collection: 'users' }, docs);
      const history = playground.getHistory();
      expect(history[0]!.id).not.toBe(history[1]!.id);
    });

    it('should include executedAt as ISO string', () => {
      playground.execute({ collection: 'users' }, docs);
      const entry = playground.getHistory()[0]!;
      expect(() => new Date(entry.executedAt)).not.toThrow();
      expect(entry.executedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should respect maxHistoryEntries limit', () => {
      const small = createProQueryPlayground({ maxHistoryEntries: 3 });
      for (let i = 0; i < 5; i++) {
        small.execute({ collection: 'users' }, docs);
      }
      expect(small.getHistory().length).toBe(3);
    });

    it('should clear history', () => {
      playground.execute({ collection: 'users' }, docs);
      playground.execute({ collection: 'users' }, docs);
      playground.clearHistory();
      expect(playground.getHistory()).toEqual([]);
    });

    it('should return a copy of history (not mutable reference)', () => {
      playground.execute({ collection: 'users' }, docs);
      const h1 = playground.getHistory();
      const h2 = playground.getHistory();
      expect(h1).not.toBe(h2);
      expect(h1).toEqual(h2);
    });
  });

  // ── Explain ───────────────────────────────────────────────────────

  describe('explain', () => {
    it('should return full-scan strategy', () => {
      const exp = playground.explain({ collection: 'users', filter: { name: 'A' } });
      expect(exp.strategy).toBe('full-scan');
    });

    it('should note filtering fields when filter is present', () => {
      const exp = playground.explain({ collection: 'users', filter: { name: 'A', age: 30 } });
      expect(exp.notes.some((n) => n.includes('name'))).toBe(true);
      expect(exp.notes.some((n) => n.includes('age'))).toBe(true);
    });

    it('should note full collection scan when no filter', () => {
      const exp = playground.explain({ collection: 'users' });
      expect(exp.notes.some((n) => n.includes('full collection scan'))).toBe(true);
    });

    it('should note limit when present', () => {
      const exp = playground.explain({ collection: 'users', limit: 10 });
      expect(exp.notes.some((n) => n.includes('10'))).toBe(true);
    });

    it('should have higher cost when no filter', () => {
      const withFilter = playground.explain({ collection: 'users', filter: { x: 1 } });
      const noFilter = playground.explain({ collection: 'users' });
      expect(noFilter.estimatedCost).toBeGreaterThan(withFilter.estimatedCost);
    });

    it('should have null indexUsed', () => {
      const exp = playground.explain({ collection: 'users', filter: { name: 'A' } });
      expect(exp.indexUsed).toBeNull();
    });

    it('should include query as JSON string', () => {
      const query = { collection: 'users', filter: { name: 'A' } };
      const exp = playground.explain(query);
      expect(exp.query).toBe(JSON.stringify(query));
    });
  });

  // ── Reactive State ────────────────────────────────────────────────

  describe('reactive state', () => {
    it('should provide initial state', async () => {
      const state = await firstValueFrom(playground.getState$());
      expect(state.query).toBe('');
      expect(state.results).toEqual([]);
      expect(state.executionTime).toBe(0);
      expect(state.error).toBeNull();
      expect(state.history).toEqual([]);
    });

    it('should update state after execution', async () => {
      playground.execute({ collection: 'users' }, docs);
      const state = await firstValueFrom(playground.getState$());
      expect(state.results.length).toBe(5);
      expect(state.history.length).toBe(1);
    });

    it('should update state after clearHistory', async () => {
      playground.execute({ collection: 'users' }, docs);
      playground.clearHistory();
      const state = await firstValueFrom(playground.getState$());
      expect(state.history).toEqual([]);
    });

    it('should track multiple executions in state history', async () => {
      playground.execute({ collection: 'users' }, docs);
      playground.execute({ collection: 'users', filter: { active: true } }, docs);
      const state = await firstValueFrom(playground.getState$());
      expect(state.history.length).toBe(2);
    });
  });

  // ── Default Config ────────────────────────────────────────────────

  describe('default config', () => {
    it('should work without config argument', () => {
      const pg = createProQueryPlayground();
      const result = pg.execute({ collection: 'x' }, [{ _id: '1', a: 1 }]);
      expect(result.resultCount).toBe(1);
    });

    it('should default maxHistoryEntries to 100', () => {
      const pg = createProQueryPlayground();
      for (let i = 0; i < 105; i++) {
        pg.execute({ collection: 'x' }, []);
      }
      expect(pg.getHistory().length).toBe(100);
    });
  });
});
