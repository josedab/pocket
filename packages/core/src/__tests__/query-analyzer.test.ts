import { describe, it, expect, beforeEach } from 'vitest';
import {
  QueryAnalyzer,
  createQueryAnalyzer,
  type QueryProfile,
  type SlowQuery,
} from '../query/query-analyzer.js';

function makeProfile(overrides: Partial<QueryProfile> = {}): QueryProfile {
  return {
    queryId: `q-${Math.random().toString(36).slice(2, 8)}`,
    collection: 'users',
    filter: { status: 'active' },
    executionTimeMs: 5,
    documentsScanned: 100,
    documentsReturned: 10,
    indexUsed: null,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('QueryAnalyzer', () => {
  let analyzer: QueryAnalyzer;

  beforeEach(() => {
    analyzer = createQueryAnalyzer({ slowQueryThresholdMs: 50 });
  });

  // ------------------------------------------------------------------
  // Record profiles
  // ------------------------------------------------------------------
  it('should record profiles', () => {
    analyzer.profile(makeProfile());
    analyzer.profile(makeProfile());
    expect(analyzer.getProfiles()).toHaveLength(2);
  });

  // ------------------------------------------------------------------
  // Detect slow queries above threshold
  // ------------------------------------------------------------------
  it('should detect slow queries above threshold', () => {
    analyzer.profile(makeProfile({ executionTimeMs: 10 }));
    analyzer.profile(makeProfile({ executionTimeMs: 200 }));
    analyzer.profile(makeProfile({ executionTimeMs: 300 }));

    const slow = analyzer.getSlowQueries();
    expect(slow).toHaveLength(2);
    // sorted desc
    expect(slow[0].profile.executionTimeMs).toBe(300);
    expect(slow[1].profile.executionTimeMs).toBe(200);
    expect(slow[0].suggestion).toBeTruthy();
  });

  it('should respect limit on getSlowQueries', () => {
    analyzer.profile(makeProfile({ executionTimeMs: 100 }));
    analyzer.profile(makeProfile({ executionTimeMs: 200 }));
    analyzer.profile(makeProfile({ executionTimeMs: 300 }));

    expect(analyzer.getSlowQueries(1)).toHaveLength(1);
  });

  // ------------------------------------------------------------------
  // Index suggestions for frequently filtered fields
  // ------------------------------------------------------------------
  it('should suggest indexes for frequently filtered fields', () => {
    for (let i = 0; i < 5; i++) {
      analyzer.profile(
        makeProfile({
          filter: { age: { $gt: 18 } },
          documentsScanned: 1000,
          documentsReturned: 5,
        }),
      );
    }

    const suggestions = analyzer.suggestIndexes();
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].fields).toContain('age');
    expect(suggestions[0].collection).toBe('users');
    expect(suggestions[0].estimatedSpeedup).toBe('high');
  });

  it('should NOT suggest indexes for fields appearing in <= 3 queries', () => {
    for (let i = 0; i < 3; i++) {
      analyzer.profile(makeProfile({ filter: { rare: 'value' } }));
    }
    expect(analyzer.suggestIndexes()).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Profile retrieval with collection filter
  // ------------------------------------------------------------------
  it('should filter profiles by collection', () => {
    analyzer.profile(makeProfile({ collection: 'users' }));
    analyzer.profile(makeProfile({ collection: 'orders' }));
    analyzer.profile(makeProfile({ collection: 'users' }));

    expect(analyzer.getProfiles('users')).toHaveLength(2);
    expect(analyzer.getProfiles('orders')).toHaveLength(1);
  });

  it('should respect limit on getProfiles', () => {
    for (let i = 0; i < 10; i++) {
      analyzer.profile(makeProfile());
    }
    expect(analyzer.getProfiles(undefined, 3)).toHaveLength(3);
  });

  // ------------------------------------------------------------------
  // Stats tracking
  // ------------------------------------------------------------------
  it('should compute stats correctly', () => {
    analyzer.profile(makeProfile({ collection: 'users', executionTimeMs: 10 }));
    analyzer.profile(makeProfile({ collection: 'users', executionTimeMs: 30 }));
    analyzer.profile(makeProfile({ collection: 'orders', executionTimeMs: 60 }));

    const stats = analyzer.getStats();
    expect(stats.totalProfiled).toBe(3);
    expect(stats.slowQueries).toBe(1); // 60 > 50 threshold
    expect(stats.avgExecutionTimeMs).toBeCloseTo(33.33, 1);
    expect(stats.topCollections[0]).toEqual({ name: 'users', queryCount: 2 });
  });

  // ------------------------------------------------------------------
  // Top queried fields
  // ------------------------------------------------------------------
  it('should return top queried fields for a collection', () => {
    analyzer.profile(makeProfile({ filter: { status: 'active' } }));
    analyzer.profile(makeProfile({ filter: { status: 'active', role: 'admin' } }));
    analyzer.profile(makeProfile({ filter: { role: 'admin' } }));

    const fields = analyzer.getTopFields('users');
    expect(fields).toHaveLength(2);
    // status: 2 times, role: 2 times
    expect(fields.find((f) => f.field === 'status')?.queryCount).toBe(2);
    expect(fields.find((f) => f.field === 'role')?.queryCount).toBe(2);
  });

  // ------------------------------------------------------------------
  // Clear profiles
  // ------------------------------------------------------------------
  it('should clear all profiles', () => {
    analyzer.profile(makeProfile());
    analyzer.profile(makeProfile());
    analyzer.clear();
    expect(analyzer.getProfiles()).toHaveLength(0);
    expect(analyzer.getStats().totalProfiled).toBe(0);
  });

  // ------------------------------------------------------------------
  // Observable emission for slow queries
  // ------------------------------------------------------------------
  it('should emit on slowQueries$ when a slow query is profiled', () => {
    const emitted: SlowQuery[] = [];
    const sub = analyzer.slowQueries$.subscribe((sq) => emitted.push(sq));

    analyzer.profile(makeProfile({ executionTimeMs: 10 }));
    analyzer.profile(makeProfile({ executionTimeMs: 200 }));
    analyzer.profile(makeProfile({ executionTimeMs: 300 }));

    expect(emitted).toHaveLength(2);
    expect(emitted[0].profile.executionTimeMs).toBe(200);
    expect(emitted[1].profile.executionTimeMs).toBe(300);

    sub.unsubscribe();
  });

  it('should NOT emit on slowQueries$ for fast queries', () => {
    const emitted: SlowQuery[] = [];
    const sub = analyzer.slowQueries$.subscribe((sq) => emitted.push(sq));

    analyzer.profile(makeProfile({ executionTimeMs: 1 }));
    expect(emitted).toHaveLength(0);

    sub.unsubscribe();
  });

  // ------------------------------------------------------------------
  // Sampling rate
  // ------------------------------------------------------------------
  it('should respect sampling rate', () => {
    let callCount = 0;
    const sampled = createQueryAnalyzer({
      samplingRate: 0.5,
      _randomFn: () => (callCount++ % 2 === 0 ? 0.3 : 0.7),
    });

    for (let i = 0; i < 100; i++) {
      sampled.profile(makeProfile());
    }
    // 0.3 < 0.5 → record, 0.7 >= 0.5 → skip → 50 recorded
    expect(sampled.getProfiles()).toHaveLength(50);
  });

  // ------------------------------------------------------------------
  // Factory
  // ------------------------------------------------------------------
  it('createQueryAnalyzer should return a QueryAnalyzer instance', () => {
    const a = createQueryAnalyzer();
    expect(a).toBeInstanceOf(QueryAnalyzer);
  });

  // ------------------------------------------------------------------
  // maxProfiles eviction
  // ------------------------------------------------------------------
  it('should evict oldest profiles when maxProfiles exceeded', () => {
    const small = createQueryAnalyzer({ maxProfiles: 3 });
    small.profile(makeProfile({ queryId: 'first' }));
    small.profile(makeProfile({ queryId: 'second' }));
    small.profile(makeProfile({ queryId: 'third' }));
    small.profile(makeProfile({ queryId: 'fourth' }));

    const profiles = small.getProfiles();
    expect(profiles).toHaveLength(3);
    expect(profiles[0].queryId).toBe('second');
  });
});
