import { describe, it, expect, beforeEach } from 'vitest';
import {
  QueryComplexityAnalyzer,
  createQueryComplexityAnalyzer,
} from '../query-complexity.js';
import type { QueryFieldNode } from '../query-complexity.js';

/* ================================================================== */
/*  QueryComplexityAnalyzer                                            */
/* ================================================================== */

describe('QueryComplexityAnalyzer', () => {
  let analyzer: QueryComplexityAnalyzer;

  beforeEach(() => {
    analyzer = createQueryComplexityAnalyzer({
      maxComplexity: 50,
      maxDepth: 3,
      defaultFieldCost: 1,
      listMultiplier: 10,
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Factory                                                          */
  /* ---------------------------------------------------------------- */

  describe('createQueryComplexityAnalyzer', () => {
    it('returns a QueryComplexityAnalyzer instance', () => {
      expect(analyzer).toBeInstanceOf(QueryComplexityAnalyzer);
    });

    it('applies defaults when no config is provided', () => {
      const defaults = createQueryComplexityAnalyzer();
      const cfg = defaults.getConfig();
      expect(cfg.maxComplexity).toBe(1000);
      expect(cfg.maxDepth).toBe(10);
      expect(cfg.defaultFieldCost).toBe(1);
      expect(cfg.listMultiplier).toBe(10);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  setFieldCost / getFieldCost / removeFieldCost                     */
  /* ---------------------------------------------------------------- */

  describe('field cost management', () => {
    it('setFieldCost stores and getFieldCost retrieves a custom cost', () => {
      analyzer.setFieldCost('Query.users', 15);
      expect(analyzer.getFieldCost('Query.users')).toBe(15);
    });

    it('getFieldCost returns defaultFieldCost for unset fields', () => {
      expect(analyzer.getFieldCost('Unknown.field')).toBe(1);
    });

    it('removeFieldCost removes a previously set cost', () => {
      analyzer.setFieldCost('Query.users', 15);
      analyzer.removeFieldCost('Query.users');
      expect(analyzer.getFieldCost('Query.users')).toBe(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  analyze                                                           */
  /* ---------------------------------------------------------------- */

  describe('analyze', () => {
    it('returns complexity score for a simple query', () => {
      const fields: QueryFieldNode[] = [
        { name: 'user' },
        { name: 'post' },
      ];
      const result = analyzer.analyze(fields);

      expect(result.allowed).toBe(true);
      expect(result.totalComplexity).toBe(2); // 2 fields × 1 cost
      expect(result.maxDepthReached).toBe(1);
      expect(result.breakdown).toHaveLength(2);
    });

    it('accumulates cost for nested fields', () => {
      const fields: QueryFieldNode[] = [
        {
          name: 'user',
          children: [
            { name: 'name' },
            { name: 'email' },
          ],
        },
      ];
      const result = analyzer.analyze(fields);

      expect(result.allowed).toBe(true);
      // user(1) + user.name(1) + user.email(1) = 3
      expect(result.totalComplexity).toBe(3);
      expect(result.maxDepthReached).toBe(2);
    });

    it('applies list multiplier to list fields', () => {
      const fields: QueryFieldNode[] = [
        {
          name: 'users',
          isList: true,
          children: [{ name: 'name' }],
        },
      ];
      const result = analyzer.analyze(fields);

      // users: 1 * 10 = 10, users.name: 1 * 10 = 10 → total 20
      expect(result.totalComplexity).toBe(20);
    });

    it('rejects when complexity exceeds maxComplexity', () => {
      const fields: QueryFieldNode[] = [
        {
          name: 'search',
          isList: true,
          children: [
            {
              name: 'results',
              isList: true,
              children: [{ name: 'title' }],
            },
          ],
        },
      ];
      const result = analyzer.analyze(fields);

      expect(result.allowed).toBe(false);
      expect(result.message).toContain('exceeds maximum allowed complexity');
    });

    it('rejects when depth exceeds maxDepth', () => {
      const fields: QueryFieldNode[] = [
        {
          name: 'a',
          children: [
            {
              name: 'b',
              children: [
                {
                  name: 'c',
                  children: [{ name: 'd' }], // depth 4 > maxDepth 3
                },
              ],
            },
          ],
        },
      ];
      const result = analyzer.analyze(fields);

      expect(result.allowed).toBe(false);
      expect(result.message).toContain('exceeds maximum allowed depth');
    });

    it('uses custom field cost when set', () => {
      analyzer.setFieldCost('expensive', 20);
      const fields: QueryFieldNode[] = [{ name: 'expensive' }];
      const result = analyzer.analyze(fields);

      expect(result.totalComplexity).toBe(20);
    });

    it('returns breakdown entries with correct paths and depths', () => {
      const fields: QueryFieldNode[] = [
        {
          name: 'user',
          children: [{ name: 'posts', isList: true }],
        },
      ];
      const result = analyzer.analyze(fields);

      expect(result.breakdown).toEqual([
        { path: 'user', cost: 1, depth: 1 },
        { path: 'user.posts', cost: 10, depth: 2 },
      ]);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  getConfig                                                         */
  /* ---------------------------------------------------------------- */

  describe('getConfig', () => {
    it('returns current configuration', () => {
      const cfg = analyzer.getConfig();
      expect(cfg).toEqual({
        maxComplexity: 50,
        maxDepth: 3,
        defaultFieldCost: 1,
        listMultiplier: 10,
      });
    });
  });
});
