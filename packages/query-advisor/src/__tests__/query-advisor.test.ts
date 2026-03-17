import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  QueryAdvisor,
  createQueryAdvisor,
  type AdvisorEvent,
  type ExistingIndex,
  type QueryProfile,
} from '../index.js';

// Helper to build a query profile input (omitting id & timestamp)
function makeQuery(overrides: Partial<Omit<QueryProfile, 'id' | 'timestamp'>> = {}) {
  return {
    collection: 'users',
    filter: { role: 'admin' } as Record<string, unknown>,
    executionTimeMs: 50,
    documentsScanned: 100,
    documentsReturned: 10,
    indexUsed: null as string | null,
    ...overrides,
  };
}

function makeIndex(overrides: Partial<ExistingIndex> = {}): ExistingIndex {
  return {
    name: 'idx_role',
    collection: 'users',
    fields: ['role'],
    unique: false,
    usageCount: 0,
    lastUsed: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('QueryAdvisor', () => {
  let advisor: QueryAdvisor;

  beforeEach(() => {
    advisor = new QueryAdvisor({ autoAnalyze: false });
  });

  afterEach(() => {
    advisor.destroy();
  });

  // ── Construction & Factory ──────────────────────────────

  describe('construction', () => {
    it('creates via constructor with defaults', () => {
      const a = new QueryAdvisor({ autoAnalyze: false });
      expect(a).toBeInstanceOf(QueryAdvisor);
      a.destroy();
    });

    it('creates via createQueryAdvisor factory', () => {
      const a = createQueryAdvisor({ autoAnalyze: false });
      expect(a).toBeInstanceOf(QueryAdvisor);
      a.destroy();
    });

    it('starts with no last report', () => {
      expect(advisor.getLastReport()).toBeNull();
    });
  });

  // ── Query Profiling ─────────────────────────────────────

  describe('recordQuery', () => {
    it('returns a full QueryProfile with generated id and timestamp', () => {
      const result = advisor.recordQuery(makeQuery());
      expect(result.id).toMatch(/^qp_\d+$/);
      expect(result.timestamp).toBeTypeOf('number');
      expect(result.collection).toBe('users');
      expect(result.filter).toEqual({ role: 'admin' });
    });

    it('assigns unique ids to each profile', () => {
      const a = advisor.recordQuery(makeQuery());
      const b = advisor.recordQuery(makeQuery());
      expect(a.id).not.toBe(b.id);
    });

    it('preserves optional fields (sort, limit, skip, fields)', () => {
      const result = advisor.recordQuery(
        makeQuery({
          sort: { createdAt: -1 },
          limit: 20,
          skip: 10,
          fields: ['name', 'email'],
        })
      );
      expect(result.sort).toEqual({ createdAt: -1 });
      expect(result.limit).toBe(20);
      expect(result.skip).toBe(10);
      expect(result.fields).toEqual(['name', 'email']);
    });

    it('enforces maxProfiles by evicting oldest entries', () => {
      const small = new QueryAdvisor({ autoAnalyze: false, maxProfiles: 3 });
      small.recordQuery(makeQuery({ executionTimeMs: 1 }));
      small.recordQuery(makeQuery({ executionTimeMs: 2 }));
      small.recordQuery(makeQuery({ executionTimeMs: 3 }));
      small.recordQuery(makeQuery({ executionTimeMs: 4 }));

      const report = small.analyze();
      expect(report.totalQueriesProfiled).toBe(3);
      // The first query (1ms) should have been evicted
      const times = report.collectionStats[0];
      expect(times.totalQueries).toBe(3);
      small.destroy();
    });

    it('emits slow_query event when execution time exceeds threshold', () => {
      const events: AdvisorEvent[] = [];
      advisor.events$.subscribe((e) => events.push(e));

      advisor.recordQuery(makeQuery({ executionTimeMs: 50 })); // under default 100ms
      expect(events.length).toBe(0);

      advisor.recordQuery(makeQuery({ executionTimeMs: 150 })); // over threshold
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('slow_query');
    });

    it('respects custom slowQueryThresholdMs', () => {
      const custom = new QueryAdvisor({ autoAnalyze: false, slowQueryThresholdMs: 10 });
      const events: AdvisorEvent[] = [];
      custom.events$.subscribe((e) => events.push(e));

      custom.recordQuery(makeQuery({ executionTimeMs: 5 }));
      expect(events.length).toBe(0);

      custom.recordQuery(makeQuery({ executionTimeMs: 15 }));
      expect(events.length).toBe(1);
      custom.destroy();
    });

    it('tracks index usage count when indexUsed matches a registered index', () => {
      const idx = makeIndex({ name: 'idx_role', usageCount: 0 });
      advisor.registerIndexes('users', [idx]);

      advisor.recordQuery(makeQuery({ indexUsed: 'idx_role' }));
      advisor.recordQuery(makeQuery({ indexUsed: 'idx_role' }));
      expect(idx.usageCount).toBe(2);
      expect(idx.lastUsed).toBeTypeOf('number');
    });

    it('does not increment usage for unregistered index names', () => {
      const idx = makeIndex({ name: 'idx_role', usageCount: 0 });
      advisor.registerIndexes('users', [idx]);

      advisor.recordQuery(makeQuery({ indexUsed: 'idx_other' }));
      expect(idx.usageCount).toBe(0);
    });
  });

  // ── Slow Queries ────────────────────────────────────────

  describe('getSlowQueries', () => {
    it('returns empty array when no profiles recorded', () => {
      expect(advisor.getSlowQueries()).toEqual([]);
    });

    it('returns only queries above threshold sorted by slowest first', () => {
      advisor.recordQuery(makeQuery({ executionTimeMs: 50 }));
      advisor.recordQuery(makeQuery({ executionTimeMs: 200 }));
      advisor.recordQuery(makeQuery({ executionTimeMs: 150 }));

      const slow = advisor.getSlowQueries();
      expect(slow.length).toBe(2);
      expect(slow[0].executionTimeMs).toBe(200);
      expect(slow[1].executionTimeMs).toBe(150);
    });

    it('excludes queries exactly at the threshold', () => {
      advisor.recordQuery(makeQuery({ executionTimeMs: 100 }));
      expect(advisor.getSlowQueries()).toEqual([]);
    });
  });

  // ── Pattern Analysis ────────────────────────────────────

  describe('identifyPatterns (via analyze)', () => {
    it('returns empty patterns when no queries recorded', () => {
      const report = advisor.analyze();
      expect(report.patterns).toEqual([]);
    });

    it('groups queries by collection + filter fields + sort fields', () => {
      advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 10 }));
      advisor.recordQuery(makeQuery({ filter: { role: 'user' }, executionTimeMs: 20 }));
      advisor.recordQuery(makeQuery({ filter: { email: 'a@b.c' }, executionTimeMs: 30 }));

      const report = advisor.analyze();
      // First two share filterFields=['role'], third has filterFields=['email']
      expect(report.patterns.length).toBe(2);

      const rolePattern = report.patterns.find((p) => p.filterFields.includes('role'));
      expect(rolePattern).toBeDefined();
      expect(rolePattern!.frequency).toBe(2);
      expect(rolePattern!.totalExecutions).toBe(2);
    });

    it('computes average and max execution times correctly', () => {
      advisor.recordQuery(makeQuery({ filter: { x: 1 }, executionTimeMs: 10 }));
      advisor.recordQuery(makeQuery({ filter: { x: 2 }, executionTimeMs: 30 }));
      advisor.recordQuery(makeQuery({ filter: { x: 3 }, executionTimeMs: 20 }));

      const report = advisor.analyze();
      const pattern = report.patterns[0];
      expect(pattern.avgExecutionTimeMs).toBe(20);
      expect(pattern.maxExecutionTimeMs).toBe(30);
    });

    it('sorts patterns by frequency descending', () => {
      // 3× on "orders"
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(
          makeQuery({ collection: 'orders', filter: { status: 'open' }, executionTimeMs: 5 })
        );
      }
      // 1× on "users"
      advisor.recordQuery(
        makeQuery({ collection: 'users', filter: { role: 'admin' }, executionTimeMs: 5 })
      );

      const report = advisor.analyze();
      expect(report.patterns[0].collection).toBe('orders');
      expect(report.patterns[0].frequency).toBe(3);
    });

    it('differentiates patterns with same filter but different sort', () => {
      advisor.recordQuery(
        makeQuery({ filter: { role: 'admin' }, sort: { name: 1 }, executionTimeMs: 10 })
      );
      advisor.recordQuery(
        makeQuery({ filter: { role: 'admin' }, sort: { createdAt: -1 }, executionTimeMs: 10 })
      );

      const report = advisor.analyze();
      expect(report.patterns.length).toBe(2);
    });

    it('treats queries with and without sort as different patterns', () => {
      advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 10 }));
      advisor.recordQuery(
        makeQuery({ filter: { role: 'admin' }, sort: { name: 1 }, executionTimeMs: 10 })
      );

      const report = advisor.analyze();
      expect(report.patterns.length).toBe(2);
    });
  });

  // ── Index Suggestions ───────────────────────────────────

  describe('suggestIndexes (via analyze)', () => {
    it('returns no suggestions when patterns are below minFrequencyForSuggestion', () => {
      // Default minFrequencyForSuggestion is 3
      advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 200 }));
      advisor.recordQuery(makeQuery({ filter: { role: 'user' }, executionTimeMs: 200 }));

      const report = advisor.analyze();
      expect(report.indexSuggestions).toEqual([]);
    });

    it('suggests single-field index when one filter field is frequent', () => {
      for (let i = 0; i < 5; i++) {
        advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 200 }));
      }
      const report = advisor.analyze();
      expect(report.indexSuggestions.length).toBe(1);
      const s = report.indexSuggestions[0];
      expect(s.type).toBe('single');
      expect(s.fields).toEqual(['role']);
      expect(s.collection).toBe('users');
      expect(s.affectedQueries).toBe(5);
    });

    it('suggests compound index for multi-field filter', () => {
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(
          makeQuery({ filter: { role: 'admin', status: 'active' }, executionTimeMs: 200 })
        );
      }
      const report = advisor.analyze();
      expect(report.indexSuggestions.length).toBe(1);
      expect(report.indexSuggestions[0].type).toBe('compound');
      expect(report.indexSuggestions[0].fields).toContain('role');
      expect(report.indexSuggestions[0].fields).toContain('status');
    });

    it('includes sort fields in compound suggestion', () => {
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(
          makeQuery({ filter: { role: 'admin' }, sort: { createdAt: -1 }, executionTimeMs: 200 })
        );
      }
      const report = advisor.analyze();
      const s = report.indexSuggestions[0];
      expect(s.type).toBe('compound');
      expect(s.fields).toEqual(['role', 'createdAt']);
    });

    it('does not suggest when existing index already covers the pattern', () => {
      advisor.registerIndexes('users', [makeIndex({ fields: ['role'] })]);
      for (let i = 0; i < 5; i++) {
        advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 200 }));
      }
      const report = advisor.analyze();
      expect(report.indexSuggestions).toEqual([]);
    });

    it('assigns high impact for slow queries', () => {
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 200 }));
      }
      const report = advisor.analyze();
      expect(report.indexSuggestions[0].estimatedImpact).toBe('high');
      expect(report.indexSuggestions[0].priority).toBe(1);
    });

    it('assigns medium impact for high-frequency but fast queries', () => {
      for (let i = 0; i < 15; i++) {
        advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 50 }));
      }
      const report = advisor.analyze();
      expect(report.indexSuggestions[0].estimatedImpact).toBe('medium');
      expect(report.indexSuggestions[0].priority).toBe(2);
    });

    it('assigns low impact for low-frequency fast queries', () => {
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 5 }));
      }
      const report = advisor.analyze();
      expect(report.indexSuggestions[0].estimatedImpact).toBe('low');
      expect(report.indexSuggestions[0].priority).toBe(3);
    });

    it('does not suggest for patterns with empty filter fields', () => {
      for (let i = 0; i < 5; i++) {
        advisor.recordQuery(makeQuery({ filter: {}, executionTimeMs: 200 }));
      }
      const report = advisor.analyze();
      expect(report.indexSuggestions).toEqual([]);
    });

    it('respects custom minFrequencyForSuggestion', () => {
      const custom = new QueryAdvisor({ autoAnalyze: false, minFrequencyForSuggestion: 1 });
      custom.recordQuery(makeQuery({ filter: { x: 1 }, executionTimeMs: 200 }));
      const report = custom.analyze();
      expect(report.indexSuggestions.length).toBe(1);
      custom.destroy();
    });

    it('sorts suggestions by priority (high before low)', () => {
      // High impact pattern
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(
          makeQuery({ collection: 'orders', filter: { status: 'open' }, executionTimeMs: 200 })
        );
      }
      // Low impact pattern
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(
          makeQuery({ collection: 'logs', filter: { level: 'info' }, executionTimeMs: 5 })
        );
      }

      const report = advisor.analyze();
      expect(report.indexSuggestions.length).toBe(2);
      expect(report.indexSuggestions[0].estimatedImpact).toBe('high');
      expect(report.indexSuggestions[1].estimatedImpact).toBe('low');
    });
  });

  // ── Query Explain ───────────────────────────────────────

  describe('explainQuery', () => {
    it('returns collection_scan → filter plan when no indexes exist', () => {
      const plan = advisor.explainQuery('users', { role: 'admin' });
      expect(plan.type).toBe('filter');
      expect(plan.fields).toEqual(['role']);
      expect(plan.children).toHaveLength(1);
      expect(plan.children![0].type).toBe('collection_scan');
      expect(plan.children![0].collection).toBe('users');
    });

    it('returns index_scan when index covers all filter fields', () => {
      advisor.registerIndexes('users', [makeIndex({ fields: ['role'] })]);
      const plan = advisor.explainQuery('users', { role: 'admin' });
      expect(plan.type).toBe('index_scan');
      expect(plan.index).toBe('idx_role');
      expect(plan.estimatedCost).toBe(1);
    });

    it('wraps in sort node when sort is not covered by index', () => {
      advisor.registerIndexes('users', [makeIndex({ fields: ['role'] })]);
      const plan = advisor.explainQuery('users', { role: 'admin' }, { createdAt: -1 });
      expect(plan.type).toBe('sort');
      expect(plan.fields).toEqual(['createdAt']);
      expect(plan.children![0].type).toBe('index_scan');
    });

    it('skips sort node when index covers both filter and sort', () => {
      advisor.registerIndexes('users', [makeIndex({ fields: ['role', 'createdAt'] })]);
      const plan = advisor.explainQuery('users', { role: 'admin' }, { createdAt: -1 });
      expect(plan.type).toBe('index_scan');
    });

    it('adds sort over filter for collection scan with sort', () => {
      const plan = advisor.explainQuery('users', { role: 'admin' }, { createdAt: -1 });
      expect(plan.type).toBe('sort');
      expect(plan.fields).toEqual(['createdAt']);
      expect(plan.estimatedCost).toBe(8);
      expect(plan.children![0].type).toBe('filter');
      expect(plan.children![0].children![0].type).toBe('collection_scan');
    });

    it('estimates higher cost for collection scan vs index scan', () => {
      const scanPlan = advisor.explainQuery('users', { role: 'admin' });
      const scanCost = scanPlan.estimatedCost + (scanPlan.children?.[0]?.estimatedCost ?? 0);

      advisor.registerIndexes('users', [makeIndex({ fields: ['role'] })]);
      const indexPlan = advisor.explainQuery('users', { role: 'admin' });

      expect(indexPlan.estimatedCost).toBeLessThan(scanCost);
    });

    it('handles multi-field filter matching compound index', () => {
      advisor.registerIndexes('users', [
        makeIndex({ name: 'idx_compound', fields: ['role', 'status'] }),
      ]);
      const plan = advisor.explainQuery('users', { role: 'admin', status: 'active' });
      expect(plan.type).toBe('index_scan');
      expect(plan.index).toBe('idx_compound');
    });

    it('falls back to collection scan if index only partially covers filter', () => {
      advisor.registerIndexes('users', [makeIndex({ fields: ['role'] })]);
      const plan = advisor.explainQuery('users', { role: 'admin', email: 'a@b.c' });
      expect(plan.type).toBe('filter');
      expect(plan.children![0].type).toBe('collection_scan');
    });

    it('handles empty filter object', () => {
      const plan = advisor.explainQuery('users', {});
      // Empty filter fields → no index match, produces filter with no fields
      expect(plan.type).toBe('filter');
      expect(plan.fields).toEqual([]);
    });

    it('returns collection_scan for an unknown collection', () => {
      const plan = advisor.explainQuery('unknown_col', { x: 1 });
      expect(plan.type).toBe('filter');
      expect(plan.children![0].type).toBe('collection_scan');
    });
  });

  // ── Unused Index Detection ──────────────────────────────

  describe('findUnusedIndexes (via analyze)', () => {
    it('returns empty when no indexes are registered', () => {
      const report = advisor.analyze();
      expect(report.unusedIndexes).toEqual([]);
    });

    it('reports indexes with zero usageCount', () => {
      advisor.registerIndexes('users', [
        makeIndex({ name: 'idx_role', usageCount: 0 }),
        makeIndex({ name: 'idx_email', fields: ['email'], usageCount: 5 }),
      ]);

      const report = advisor.analyze();
      expect(report.unusedIndexes).toHaveLength(1);
      expect(report.unusedIndexes[0].name).toBe('idx_role');
    });

    it('reports unused indexes from multiple collections', () => {
      advisor.registerIndexes('users', [makeIndex({ name: 'idx_a', usageCount: 0 })]);
      advisor.registerIndexes('orders', [
        makeIndex({ name: 'idx_b', collection: 'orders', usageCount: 0 }),
      ]);

      const report = advisor.analyze();
      expect(report.unusedIndexes).toHaveLength(2);
    });

    it('excludes indexes that have been used via recordQuery', () => {
      const idx = makeIndex({ name: 'idx_role', usageCount: 0 });
      advisor.registerIndexes('users', [idx]);
      advisor.recordQuery(makeQuery({ indexUsed: 'idx_role' }));

      const report = advisor.analyze();
      expect(report.unusedIndexes).toHaveLength(0);
    });
  });

  // ── Recommendations ─────────────────────────────────────

  describe('recommendations (via analyze)', () => {
    it('generates create_index recommendation for slow frequent patterns', () => {
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(makeQuery({ filter: { role: 'admin' }, executionTimeMs: 200 }));
      }
      const report = advisor.analyze();
      const createIdx = report.recommendations.filter((r) => r.type === 'create_index');
      expect(createIdx.length).toBeGreaterThanOrEqual(1);
      expect(createIdx[0].severity).toBe('critical');
      expect(createIdx[0].suggestedAction).toContain('createIndex');
    });

    it('generates add_limit recommendation for limitless queries scanning many docs', () => {
      advisor.recordQuery(
        makeQuery({
          executionTimeMs: 200,
          documentsScanned: 5000,
          limit: undefined,
        })
      );
      const report = advisor.analyze();
      const limitRecs = report.recommendations.filter((r) => r.type === 'add_limit');
      expect(limitRecs.length).toBeGreaterThanOrEqual(1);
      expect(limitRecs[0].severity).toBe('warning');
    });

    it('does not generate add_limit when query has a limit', () => {
      advisor.recordQuery(
        makeQuery({
          executionTimeMs: 200,
          documentsScanned: 5000,
          limit: 100,
        })
      );
      const report = advisor.analyze();
      const limitRecs = report.recommendations.filter((r) => r.type === 'add_limit');
      expect(limitRecs).toEqual([]);
    });

    it('does not generate add_limit when documents scanned is low', () => {
      advisor.recordQuery(
        makeQuery({ executionTimeMs: 200, documentsScanned: 500, limit: undefined })
      );
      const report = advisor.analyze();
      const limitRecs = report.recommendations.filter((r) => r.type === 'add_limit');
      expect(limitRecs).toEqual([]);
    });

    it('generates use_projection recommendation for slow queries without fields', () => {
      advisor.recordQuery(makeQuery({ executionTimeMs: 200, fields: undefined }));
      const report = advisor.analyze();
      const projRecs = report.recommendations.filter((r) => r.type === 'use_projection');
      expect(projRecs.length).toBeGreaterThanOrEqual(1);
      expect(projRecs[0].severity).toBe('info');
    });

    it('does not generate use_projection when fields are specified', () => {
      advisor.recordQuery(makeQuery({ executionTimeMs: 200, fields: ['name'] }));
      const report = advisor.analyze();
      const projRecs = report.recommendations.filter((r) => r.type === 'use_projection');
      expect(projRecs).toEqual([]);
    });

    it('generates use_projection for slow queries with empty fields array', () => {
      advisor.recordQuery(makeQuery({ executionTimeMs: 200, fields: [] }));
      const report = advisor.analyze();
      const projRecs = report.recommendations.filter((r) => r.type === 'use_projection');
      expect(projRecs.length).toBeGreaterThanOrEqual(1);
    });

    it('assigns unique ids to each recommendation', () => {
      for (let i = 0; i < 3; i++) {
        advisor.recordQuery(
          makeQuery({
            filter: { role: 'admin' },
            executionTimeMs: 200,
            documentsScanned: 5000,
            limit: undefined,
            fields: undefined,
          })
        );
      }
      const report = advisor.analyze();
      const ids = report.recommendations.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ── Collection Stats ────────────────────────────────────

  describe('collectionStats (via analyze)', () => {
    it('returns empty stats when no queries recorded', () => {
      const report = advisor.analyze();
      expect(report.collectionStats).toEqual([]);
    });

    it('computes per-collection statistics', () => {
      advisor.recordQuery(makeQuery({ collection: 'users', executionTimeMs: 10, indexUsed: null }));
      advisor.recordQuery(
        makeQuery({ collection: 'users', executionTimeMs: 20, indexUsed: 'idx_r' })
      );
      advisor.recordQuery(
        makeQuery({ collection: 'orders', executionTimeMs: 30, indexUsed: null })
      );

      const report = advisor.analyze();
      expect(report.collectionStats).toHaveLength(2);

      const userStats = report.collectionStats.find((s) => s.collection === 'users')!;
      expect(userStats.totalQueries).toBe(2);
      expect(userStats.avgExecutionTimeMs).toBe(15);
      expect(userStats.fullScans).toBe(1);
      expect(userStats.indexedQueries).toBe(1);
    });

    it('computes p95 and p99 execution times', () => {
      // Record 100 queries with execution times 1..100
      for (let i = 1; i <= 100; i++) {
        advisor.recordQuery(makeQuery({ executionTimeMs: i }));
      }
      const report = advisor.analyze();
      const stats = report.collectionStats[0];
      expect(stats.p95ExecutionTimeMs).toBe(96); // index 95
      expect(stats.p99ExecutionTimeMs).toBe(100); // index 99
    });
  });

  // ── Diagnostics Report ──────────────────────────────────

  describe('analyze (full report)', () => {
    it('returns a complete DiagnosticsReport', () => {
      advisor.recordQuery(makeQuery({ executionTimeMs: 200, documentsScanned: 5000 }));
      const report = advisor.analyze();

      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('totalQueriesProfiled');
      expect(report).toHaveProperty('slowQueries');
      expect(report).toHaveProperty('patterns');
      expect(report).toHaveProperty('indexSuggestions');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('unusedIndexes');
      expect(report).toHaveProperty('collectionStats');
    });

    it('stores and retrieves last report', () => {
      advisor.recordQuery(makeQuery());
      const report = advisor.analyze();
      expect(advisor.getLastReport()).toBe(report);
    });

    it('emits analysis_complete event', () => {
      const events: AdvisorEvent[] = [];
      advisor.events$.subscribe((e) => events.push(e));

      advisor.analyze();
      const analysis = events.find((e) => e.type === 'analysis_complete');
      expect(analysis).toBeDefined();
      expect(analysis!.type).toBe('analysis_complete');
    });

    it('totalQueriesProfiled equals number of recorded queries', () => {
      advisor.recordQuery(makeQuery());
      advisor.recordQuery(makeQuery());
      advisor.recordQuery(makeQuery());

      const report = advisor.analyze();
      expect(report.totalQueriesProfiled).toBe(3);
    });
  });

  // ── clearProfiles ───────────────────────────────────────

  describe('clearProfiles', () => {
    it('removes all profiled queries', () => {
      advisor.recordQuery(makeQuery());
      advisor.recordQuery(makeQuery());
      advisor.clearProfiles();

      const report = advisor.analyze();
      expect(report.totalQueriesProfiled).toBe(0);
      expect(report.patterns).toEqual([]);
    });

    it('leaves registered indexes untouched', () => {
      advisor.registerIndexes('users', [makeIndex({ name: 'idx_a', usageCount: 0 })]);
      advisor.clearProfiles();

      const report = advisor.analyze();
      expect(report.unusedIndexes).toHaveLength(1);
    });
  });

  // ── destroy ─────────────────────────────────────────────

  describe('destroy', () => {
    it('completes the events$ observable', () => {
      let completed = false;
      advisor.events$.subscribe({
        complete: () => {
          completed = true;
        },
      });
      advisor.destroy();
      expect(completed).toBe(true);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('handles a single query gracefully', () => {
      advisor.recordQuery(makeQuery({ executionTimeMs: 5 }));
      const report = advisor.analyze();
      expect(report.totalQueriesProfiled).toBe(1);
      expect(report.patterns).toHaveLength(1);
      expect(report.patterns[0].frequency).toBe(1);
      expect(report.patterns[0].avgExecutionTimeMs).toBe(5);
    });

    it('handles many queries across many collections', () => {
      for (let i = 0; i < 50; i++) {
        advisor.recordQuery(
          makeQuery({ collection: `col_${i % 10}`, filter: { field: i }, executionTimeMs: i })
        );
      }
      const report = advisor.analyze();
      expect(report.collectionStats).toHaveLength(10);
      expect(report.totalQueriesProfiled).toBe(50);
    });

    it('handles queries with complex nested filter objects', () => {
      advisor.recordQuery(
        makeQuery({
          filter: { 'address.city': 'NY', 'tags.0': 'vip' },
          executionTimeMs: 200,
        })
      );
      const report = advisor.analyze();
      const pattern = report.patterns[0];
      expect(pattern.filterFields).toContain('address.city');
      expect(pattern.filterFields).toContain('tags.0');
    });

    it('analyze can be called multiple times, updating lastReport each time', () => {
      advisor.recordQuery(makeQuery());
      const first = advisor.analyze();
      advisor.recordQuery(makeQuery());
      const second = advisor.analyze();

      expect(advisor.getLastReport()).toBe(second);
      expect(second.totalQueriesProfiled).toBe(2);
      expect(first.totalQueriesProfiled).toBe(1);
    });

    it('registerIndexes replaces indexes for a collection', () => {
      advisor.registerIndexes('users', [makeIndex({ name: 'idx_a', usageCount: 0 })]);
      advisor.registerIndexes('users', [makeIndex({ name: 'idx_b', usageCount: 0 })]);

      const report = advisor.analyze();
      expect(report.unusedIndexes).toHaveLength(1);
      expect(report.unusedIndexes[0].name).toBe('idx_b');
    });
  });
});
