import { describe, it, expect, beforeEach } from 'vitest';
import {
  PaginationHelper,
  createPaginationHelper,
} from '../pagination.js';
import type { Connection, OffsetPage } from '../pagination.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sampleItems(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/* ================================================================== */
/*  PaginationHelper                                                   */
/* ================================================================== */

describe('PaginationHelper', () => {
  let helper: PaginationHelper;

  beforeEach(() => {
    helper = createPaginationHelper({ defaultPageSize: 10, maxPageSize: 50 });
  });

  /* ---------------------------------------------------------------- */
  /*  Factory                                                          */
  /* ---------------------------------------------------------------- */

  describe('createPaginationHelper', () => {
    it('returns a PaginationHelper instance', () => {
      expect(helper).toBeInstanceOf(PaginationHelper);
    });

    it('applies defaults when no config is provided', () => {
      const defaults = createPaginationHelper();
      const cfg = defaults.getConfig();
      expect(cfg.defaultPageSize).toBe(25);
      expect(cfg.maxPageSize).toBe(100);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  encodeCursor / decodeCursor                                       */
  /* ---------------------------------------------------------------- */

  describe('encodeCursor / decodeCursor', () => {
    it('roundtrips an offset through encode → decode', () => {
      const cursor = helper.encodeCursor(42);
      expect(helper.decodeCursor(cursor)).toBe(42);
    });

    it('roundtrips offset 0', () => {
      const cursor = helper.encodeCursor(0);
      expect(helper.decodeCursor(cursor)).toBe(0);
    });

    it('throws for an invalid cursor string', () => {
      expect(() => helper.decodeCursor('bad-cursor')).toThrow('invalid cursor');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  createConnection                                                  */
  /* ---------------------------------------------------------------- */

  describe('createConnection', () => {
    it('creates a connection from items', () => {
      const items = sampleItems(5);
      const conn = helper.createConnection(items);

      expect(conn.edges).toHaveLength(5);
      expect(conn.totalCount).toBe(5);
      expect(conn.edges[0]!.node).toBe(1);
      expect(conn.edges[4]!.node).toBe(5);
    });

    it('returns an empty connection for empty items', () => {
      const conn = helper.createConnection([]);

      expect(conn.edges).toHaveLength(0);
      expect(conn.totalCount).toBe(0);
      expect(conn.pageInfo.startCursor).toBeNull();
      expect(conn.pageInfo.endCursor).toBeNull();
      expect(conn.pageInfo.hasNextPage).toBe(false);
      expect(conn.pageInfo.hasPreviousPage).toBe(false);
    });

    it('paginates forward with first/after', () => {
      const items = sampleItems(10);
      const afterCursor = helper.encodeCursor(2); // after index 2

      const conn = helper.createConnection(items, { first: 3, after: afterCursor });

      // Should start from index 3, take 3 items: 4, 5, 6
      expect(conn.edges.map((e) => e.node)).toEqual([4, 5, 6]);
      expect(conn.pageInfo.hasPreviousPage).toBe(true);
      expect(conn.pageInfo.hasNextPage).toBe(true);
    });

    it('paginates backward with last/before', () => {
      const items = sampleItems(10);
      const beforeCursor = helper.encodeCursor(7); // before index 7

      const conn = helper.createConnection(items, { last: 3, before: beforeCursor });

      // endIndex clamped to 7, take last 3: indices 4,5,6 → items 5,6,7
      expect(conn.edges.map((e) => e.node)).toEqual([5, 6, 7]);
      expect(conn.pageInfo.hasPreviousPage).toBe(true);
    });

    it('has correct pageInfo', () => {
      const items = sampleItems(20);
      const conn = helper.createConnection(items, { first: 5, totalCount: 20 });

      expect(conn.pageInfo.hasNextPage).toBe(true);
      expect(conn.pageInfo.hasPreviousPage).toBe(false);
      expect(conn.pageInfo.startCursor).toBeDefined();
      expect(conn.pageInfo.endCursor).toBeDefined();
      expect(conn.totalCount).toBe(20);
    });

    it('clamps first to maxPageSize', () => {
      const items = sampleItems(100);
      const conn = helper.createConnection(items, { first: 200 });

      // maxPageSize is 50
      expect(conn.edges).toHaveLength(50);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  createOffsetPage                                                  */
  /* ---------------------------------------------------------------- */

  describe('createOffsetPage', () => {
    it('creates a page from items', () => {
      const items = sampleItems(30);
      const page = helper.createOffsetPage(items);

      expect(page.items).toHaveLength(10); // defaultPageSize = 10
      expect(page.totalCount).toBe(30);
      expect(page.offset).toBe(0);
      expect(page.limit).toBe(10);
    });

    it('applies offset and limit', () => {
      const items = sampleItems(20);
      const page = helper.createOffsetPage(items, { offset: 5, limit: 3 });

      expect(page.items).toEqual([6, 7, 8]);
      expect(page.offset).toBe(5);
      expect(page.limit).toBe(3);
      expect(page.hasNextPage).toBe(true);
      expect(page.hasPreviousPage).toBe(true);
    });

    it('first page has no previous page', () => {
      const items = sampleItems(20);
      const page = helper.createOffsetPage(items, { offset: 0, limit: 5 });

      expect(page.hasPreviousPage).toBe(false);
      expect(page.hasNextPage).toBe(true);
    });

    it('last page has no next page', () => {
      const items = sampleItems(10);
      const page = helper.createOffsetPage(items, { offset: 5, limit: 5 });

      expect(page.hasNextPage).toBe(false);
      expect(page.hasPreviousPage).toBe(true);
    });

    it('accepts totalCount override', () => {
      const items = sampleItems(5);
      const page = helper.createOffsetPage(items, { totalCount: 100 });

      expect(page.totalCount).toBe(100);
      expect(page.hasNextPage).toBe(true);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  generateConnectionTypes                                           */
  /* ---------------------------------------------------------------- */

  describe('generateConnectionTypes', () => {
    it('creates PageInfo, Edge, and Connection type definitions', () => {
      const types = helper.generateConnectionTypes('User');

      expect(types).toHaveLength(3);
      expect(types.map((t) => t.name)).toEqual([
        'PageInfo',
        'UserEdge',
        'UserConnection',
      ]);
    });

    it('Edge type has node and cursor fields', () => {
      const types = helper.generateConnectionTypes('Post');
      const edge = types.find((t) => t.name === 'PostEdge')!;

      expect(edge.fields.map((f) => f.name)).toEqual(['node', 'cursor']);
      expect(edge.fields.find((f) => f.name === 'node')!.type).toBe('Post');
    });

    it('Connection type has edges, pageInfo, and totalCount fields', () => {
      const types = helper.generateConnectionTypes('Post');
      const conn = types.find((t) => t.name === 'PostConnection')!;

      expect(conn.fields.map((f) => f.name)).toEqual([
        'edges',
        'pageInfo',
        'totalCount',
      ]);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  generateConnectionSDL                                             */
  /* ---------------------------------------------------------------- */

  describe('generateConnectionSDL', () => {
    it('creates a valid SDL string', () => {
      const sdl = helper.generateConnectionSDL('User');

      expect(sdl).toContain('type PageInfo {');
      expect(sdl).toContain('type UserEdge {');
      expect(sdl).toContain('type UserConnection {');
      expect(sdl).toContain('hasNextPage: Boolean!');
      expect(sdl).toContain('node: User!');
      expect(sdl).toContain('cursor: String!');
      expect(sdl).toContain('totalCount: Int!');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  getConfig                                                         */
  /* ---------------------------------------------------------------- */

  describe('getConfig', () => {
    it('returns current configuration', () => {
      const cfg = helper.getConfig();
      expect(cfg).toEqual({ defaultPageSize: 10, maxPageSize: 50 });
    });
  });
});
