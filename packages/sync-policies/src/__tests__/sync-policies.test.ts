import { describe, expect, it } from 'vitest';
import type {
  ComparisonFilter,
  CustomFilter,
  ExistsFilter,
  FilterExpression,
  InFilter,
  LogicalFilter,
  SyncPolicyDefinition,
  TimeFilter,
} from '../index.js';
import {
  createPolicyEvaluator,
  deserializePolicy,
  evaluateFilter,
  FilterBuilder,
  PolicyEvaluator,
  serializePolicy,
  syncPolicy,
  SyncPolicyBuilder,
  validatePolicy,
} from '../index.js';

// ── Helpers ───────────────────────────────────────────────

function minimalPolicy(overrides?: Partial<SyncPolicyDefinition>): SyncPolicyDefinition {
  return {
    name: 'test-policy',
    version: 1,
    collections: [{ collection: 'items', direction: 'both', priority: 'normal', enabled: true }],
    ...overrides,
  };
}

function buildSimplePolicy() {
  return syncPolicy('simple')
    .collection('docs')
    .direction('both')
    .priority('normal')
    .done()
    .build();
}

// ═══════════════════════════════════════════════════════════
// Policy Builder
// ═══════════════════════════════════════════════════════════

describe('Policy Builder', () => {
  describe('syncPolicy entry point', () => {
    it('creates a SyncPolicyBuilder', () => {
      const builder = syncPolicy('my-policy');
      expect(builder).toBeInstanceOf(SyncPolicyBuilder);
    });

    it('throws on empty name', () => {
      expect(() => syncPolicy('')).toThrow('Policy name is required');
    });

    it('throws on whitespace-only name', () => {
      expect(() => syncPolicy('   ')).toThrow('Policy name is required');
    });
  });

  describe('basic policy building', () => {
    it('builds a minimal policy with one collection', () => {
      const policy = buildSimplePolicy();
      expect(policy.name).toBe('simple');
      expect(policy.version).toBe(1);
      expect(policy.collections).toHaveLength(1);
      expect(policy.collections[0]!.collection).toBe('docs');
      expect(policy.collections[0]!.direction).toBe('both');
      expect(policy.collections[0]!.priority).toBe('normal');
      expect(policy.collections[0]!.enabled).toBe(true);
    });

    it('sets description', () => {
      const policy = syncPolicy('p').description('A test policy').collection('c').done().build();
      expect(policy.description).toBe('A test policy');
    });

    it('sets version', () => {
      const policy = syncPolicy('p').version(5).collection('c').done().build();
      expect(policy.version).toBe(5);
    });

    it('throws on version < 1', () => {
      expect(() => syncPolicy('p').version(0)).toThrow('Version must be >= 1');
    });

    it('throws when no collections configured', () => {
      expect(() => syncPolicy('p').build()).toThrow('has no collections configured');
    });
  });

  describe('collection builder', () => {
    it('sets collection defaults', () => {
      const policy = syncPolicy('p').collection('c').done().build();
      const col = policy.collections[0]!;
      expect(col.direction).toBe('both');
      expect(col.priority).toBe('normal');
      expect(col.enabled).toBe(true);
    });

    it('sets direction', () => {
      const policy = syncPolicy('p').collection('c').direction('pull').done().build();
      expect(policy.collections[0]!.direction).toBe('pull');
    });

    it('sets priority', () => {
      const policy = syncPolicy('p').collection('c').priority('critical').done().build();
      expect(policy.collections[0]!.priority).toBe('critical');
    });

    it('sets includeFields', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .includeFields('id', 'name', 'email')
        .done()
        .build();
      expect(policy.collections[0]!.fields).toEqual({
        mode: 'include',
        fields: ['id', 'name', 'email'],
      });
    });

    it('sets excludeFields', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .excludeFields('password', 'secret')
        .done()
        .build();
      expect(policy.collections[0]!.fields).toEqual({
        mode: 'exclude',
        fields: ['password', 'secret'],
      });
    });

    it('sets conflictStrategy', () => {
      const policy = syncPolicy('p').collection('c').conflictStrategy('server-wins').done().build();
      expect(policy.collections[0]!.conflictStrategy).toBe('server-wins');
    });

    it('sets batchSize', () => {
      const policy = syncPolicy('p').collection('c').batchSize(50).done().build();
      expect(policy.collections[0]!.batchSize).toBe(50);
    });

    it('throws on batchSize < 1', () => {
      expect(() => syncPolicy('p').collection('c').batchSize(0)).toThrow(
        'Batch size must be positive'
      );
    });

    it('sets rateLimit', () => {
      const policy = syncPolicy('p').collection('c').rateLimit(60).done().build();
      expect(policy.collections[0]!.rateLimit).toBe(60);
    });

    it('throws on rateLimit < 1', () => {
      expect(() => syncPolicy('p').collection('c').rateLimit(0)).toThrow(
        'Rate limit must be positive'
      );
    });

    it('sets ttl', () => {
      const policy = syncPolicy('p').collection('c').ttl(30000).done().build();
      expect(policy.collections[0]!.ttl).toBe(30000);
    });

    it('throws on negative ttl', () => {
      expect(() => syncPolicy('p').collection('c').ttl(-1)).toThrow('TTL must be non-negative');
    });

    it('allows ttl of 0', () => {
      const policy = syncPolicy('p').collection('c').ttl(0).done().build();
      expect(policy.collections[0]!.ttl).toBe(0);
    });

    it('sets disabled', () => {
      const policy = syncPolicy('p').collection('c').disabled().done().build();
      expect(policy.collections[0]!.enabled).toBe(false);
    });

    it('replaces duplicate collection names', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .priority('low')
        .done()
        .collection('c')
        .priority('high')
        .done()
        .build();
      expect(policy.collections).toHaveLength(1);
      expect(policy.collections[0]!.priority).toBe('high');
    });
  });

  describe('multiple collections', () => {
    it('supports multiple collections', () => {
      const policy = syncPolicy('p')
        .collection('messages')
        .direction('both')
        .priority('high')
        .done()
        .collection('attachments')
        .direction('pull')
        .priority('low')
        .done()
        .collection('settings')
        .direction('push')
        .priority('normal')
        .done()
        .build();
      expect(policy.collections).toHaveLength(3);
      expect(policy.collections.map((c) => c.collection)).toEqual([
        'messages',
        'attachments',
        'settings',
      ]);
    });
  });

  describe('globals / defaults', () => {
    it('sets global defaults', () => {
      const policy = syncPolicy('p')
        .defaults({ defaultDirection: 'pull', maxBatchSize: 200, enableCompression: false })
        .collection('c')
        .done()
        .build();
      expect(policy.globals).toBeDefined();
      expect(policy.globals!.defaultDirection).toBe('pull');
      expect(policy.globals!.maxBatchSize).toBe(200);
      expect(policy.globals!.enableCompression).toBe(false);
      // Check defaults for unspecified fields
      expect(policy.globals!.defaultPriority).toBe('normal');
      expect(policy.globals!.defaultConflictStrategy).toBe('latest-wins');
      expect(policy.globals!.maxDocumentSizeBytes).toBe(1024 * 1024);
      expect(policy.globals!.syncIntervalMs).toBe(5000);
    });
  });

  describe('user scopes', () => {
    it('adds user scope with roles and override', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .done()
        .userScope('admin', (u) => u.roles('admin').override('c', { priority: 'critical' }))
        .build();
      expect(policy.userScopes).toBeDefined();
      expect(policy.userScopes).toHaveLength(1);
      expect(policy.userScopes![0]!.name).toBe('admin:c');
      expect(policy.userScopes![0]!.condition.roles).toEqual(['admin']);
      expect(policy.userScopes![0]!.overrides.priority).toBe('critical');
    });

    it('adds user scope with properties', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .done()
        .userScope('premium', (u) =>
          u.property('plan', 'premium').override('c', { batchSize: 500 })
        )
        .build();
      expect(policy.userScopes![0]!.condition.properties).toEqual({ plan: 'premium' });
    });

    it('adds user scope with custom condition', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .done()
        .userScope('custom', (u) =>
          u.customCondition('user.age > 18').override('c', { enabled: true })
        )
        .build();
      expect(policy.userScopes![0]!.condition.custom).toBe('user.age > 18');
    });

    it('supports multiple overrides per scope', () => {
      const policy = syncPolicy('p')
        .collection('a')
        .done()
        .collection('b')
        .done()
        .userScope('admin', (u) =>
          u
            .roles('admin')
            .override('a', { priority: 'critical' })
            .override('b', { direction: 'both' })
        )
        .build();
      expect(policy.userScopes).toHaveLength(2);
      expect(policy.userScopes![0]!.name).toBe('admin:a');
      expect(policy.userScopes![1]!.name).toBe('admin:b');
    });

    it('omits userScopes when none defined', () => {
      const policy = buildSimplePolicy();
      expect(policy.userScopes).toBeUndefined();
    });
  });

  describe('bandwidth config', () => {
    it('sets bandwidth config', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .done()
        .bandwidth({ mode: 'metered', maxBytesPerSync: 5_000_000, throttleMs: 1000 })
        .build();
      expect(policy.bandwidthConfig).toEqual({
        mode: 'metered',
        maxBytesPerSync: 5_000_000,
        throttleMs: 1000,
      });
    });

    it('supports offline mode', () => {
      const policy = syncPolicy('p').collection('c').done().bandwidth({ mode: 'offline' }).build();
      expect(policy.bandwidthConfig!.mode).toBe('offline');
    });

    it('supports unlimited mode', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .done()
        .bandwidth({ mode: 'unlimited' })
        .build();
      expect(policy.bandwidthConfig!.mode).toBe('unlimited');
    });

    it('supports prioritizeCollections', () => {
      const policy = syncPolicy('p')
        .collection('a')
        .done()
        .collection('b')
        .done()
        .bandwidth({ mode: 'metered', prioritizeCollections: ['a'] })
        .build();
      expect(policy.bandwidthConfig!.prioritizeCollections).toEqual(['a']);
    });
  });

  describe('collection filter via builder', () => {
    it('adds a comparison filter to collection', () => {
      const policy = syncPolicy('p')
        .collection('c')
        .filter((f) => f.field('status').eq('active'))
        .done()
        .build();
      const filter = policy.collections[0]!.filter as ComparisonFilter;
      expect(filter.type).toBe('comparison');
      expect(filter.field).toBe('status');
      expect(filter.operator).toBe('eq');
      expect(filter.value).toBe('active');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Filter Builder
// ═══════════════════════════════════════════════════════════

describe('Filter Builder', () => {
  describe('comparison filters', () => {
    it('builds eq filter', () => {
      const fb = new FilterBuilder();
      fb.field('name').eq('Alice');
      const expr = fb._getExpr() as ComparisonFilter;
      expect(expr).toEqual({ type: 'comparison', field: 'name', operator: 'eq', value: 'Alice' });
    });

    it('builds ne filter', () => {
      const fb = new FilterBuilder();
      fb.field('status').ne('deleted');
      const expr = fb._getExpr() as ComparisonFilter;
      expect(expr.operator).toBe('ne');
      expect(expr.value).toBe('deleted');
    });

    it('builds gt filter', () => {
      const fb = new FilterBuilder();
      fb.field('age').gt(18);
      const expr = fb._getExpr() as ComparisonFilter;
      expect(expr.operator).toBe('gt');
      expect(expr.value).toBe(18);
    });

    it('builds gte filter', () => {
      const fb = new FilterBuilder();
      fb.field('score').gte(100);
      const expr = fb._getExpr() as ComparisonFilter;
      expect(expr.operator).toBe('gte');
    });

    it('builds lt filter', () => {
      const fb = new FilterBuilder();
      fb.field('size').lt(1024);
      const expr = fb._getExpr() as ComparisonFilter;
      expect(expr.operator).toBe('lt');
    });

    it('builds lte filter', () => {
      const fb = new FilterBuilder();
      fb.field('count').lte(0);
      const expr = fb._getExpr() as ComparisonFilter;
      expect(expr.operator).toBe('lte');
      expect(expr.value).toBe(0);
    });
  });

  describe('in / notIn filters', () => {
    it('builds in filter', () => {
      const fb = new FilterBuilder();
      fb.field('role').in(['admin', 'editor']);
      const expr = fb._getExpr() as InFilter;
      expect(expr).toEqual({ type: 'in', field: 'role', values: ['admin', 'editor'] });
    });

    it('builds notIn filter', () => {
      const fb = new FilterBuilder();
      fb.field('status').notIn(['deleted', 'archived']);
      const expr = fb._getExpr() as InFilter;
      expect(expr.negate).toBe(true);
    });
  });

  describe('exists filter', () => {
    it('builds exists=true filter', () => {
      const fb = new FilterBuilder();
      fb.field('avatar').exists();
      const expr = fb._getExpr() as ExistsFilter;
      expect(expr).toEqual({ type: 'exists', field: 'avatar', exists: true });
    });

    it('builds exists=false filter', () => {
      const fb = new FilterBuilder();
      fb.field('deletedAt').exists(false);
      const expr = fb._getExpr() as ExistsFilter;
      expect(expr.exists).toBe(false);
    });
  });

  describe('logical filters', () => {
    it('builds AND filter', () => {
      const fb = new FilterBuilder();
      fb.and(
        (f) => f.field('age').gte(18),
        (f) => f.field('active').eq(true)
      );
      const expr = fb._getExpr() as LogicalFilter;
      expect(expr.type).toBe('and');
      expect(expr.conditions).toHaveLength(2);
    });

    it('builds OR filter', () => {
      const fb = new FilterBuilder();
      fb.or(
        (f) => f.field('role').eq('admin'),
        (f) => f.field('role').eq('editor')
      );
      const expr = fb._getExpr() as LogicalFilter;
      expect(expr.type).toBe('or');
      expect(expr.conditions).toHaveLength(2);
    });

    it('builds NOT filter', () => {
      const fb = new FilterBuilder();
      fb.not((f) => f.field('deleted').eq(true));
      const expr = fb._getExpr() as LogicalFilter;
      expect(expr.type).toBe('not');
      expect(expr.conditions).toHaveLength(1);
    });

    it('throws on empty and clause', () => {
      const fb = new FilterBuilder();
      expect(() => fb.and((f) => f)).toThrow('Empty filter in and() clause');
    });

    it('throws on empty or clause', () => {
      const fb = new FilterBuilder();
      expect(() => fb.or((f) => f)).toThrow('Empty filter in or() clause');
    });

    it('throws on empty not clause', () => {
      const fb = new FilterBuilder();
      expect(() => fb.not((f) => f)).toThrow('Empty filter in not() clause');
    });
  });

  describe('time filter', () => {
    it('builds since filter', () => {
      const fb = new FilterBuilder();
      fb.since('createdAt', 1000);
      const expr = fb._getExpr() as TimeFilter;
      expect(expr).toEqual({ type: 'time', field: 'createdAt', since: 1000 });
    });

    it('builds since filter with string date', () => {
      const fb = new FilterBuilder();
      fb.since('updatedAt', '2024-01-01');
      const expr = fb._getExpr() as TimeFilter;
      expect(expr.since).toBe('2024-01-01');
    });
  });

  describe('custom filter', () => {
    it('builds custom filter with params', () => {
      const fb = new FilterBuilder();
      fb.custom('geo-radius', { lat: 40.7, lng: -74.0, radius: 10 });
      const expr = fb._getExpr() as CustomFilter;
      expect(expr.type).toBe('custom');
      expect(expr.name).toBe('geo-radius');
      expect(expr.params).toEqual({ lat: 40.7, lng: -74.0, radius: 10 });
    });

    it('builds custom filter without params', () => {
      const fb = new FilterBuilder();
      fb.custom('always-pass');
      const expr = fb._getExpr() as CustomFilter;
      expect(expr.params).toBeUndefined();
    });
  });

  describe('nested logical filters', () => {
    it('supports deeply nested filters', () => {
      const fb = new FilterBuilder();
      fb.and(
        (f) =>
          f.or(
            (g) => g.field('status').eq('active'),
            (g) => g.field('status').eq('pending')
          ),
        (f) => f.not((g) => g.field('deleted').eq(true))
      );
      const expr = fb._getExpr() as LogicalFilter;
      expect(expr.type).toBe('and');
      expect(expr.conditions).toHaveLength(2);
      expect((expr.conditions[0] as LogicalFilter).type).toBe('or');
      expect((expr.conditions[1] as LogicalFilter).type).toBe('not');
    });
  });

  describe('empty filter builder', () => {
    it('returns null when no expression set', () => {
      const fb = new FilterBuilder();
      expect(fb._getExpr()).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Policy Evaluator — evaluateFilter
// ═══════════════════════════════════════════════════════════

describe('evaluateFilter', () => {
  describe('comparison filters', () => {
    it('eq matches equal values', () => {
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'eq', value: 5 }, { x: 5 })
      ).toBe(true);
    });

    it('eq rejects unequal values', () => {
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'eq', value: 5 }, { x: 6 })
      ).toBe(false);
    });

    it('ne matches unequal values', () => {
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'ne', value: 5 }, { x: 6 })
      ).toBe(true);
    });

    it('gt works correctly', () => {
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'gt', value: 5 }, { x: 10 })
      ).toBe(true);
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'gt', value: 5 }, { x: 5 })
      ).toBe(false);
    });

    it('gte works correctly', () => {
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'gte', value: 5 }, { x: 5 })
      ).toBe(true);
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'gte', value: 5 }, { x: 4 })
      ).toBe(false);
    });

    it('lt works correctly', () => {
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'lt', value: 5 }, { x: 3 })
      ).toBe(true);
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'lt', value: 5 }, { x: 5 })
      ).toBe(false);
    });

    it('lte works correctly', () => {
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'lte', value: 5 }, { x: 5 })
      ).toBe(true);
      expect(
        evaluateFilter({ type: 'comparison', field: 'x', operator: 'lte', value: 5 }, { x: 6 })
      ).toBe(false);
    });

    it('handles string comparison with eq', () => {
      expect(
        evaluateFilter(
          { type: 'comparison', field: 'name', operator: 'eq', value: 'alice' },
          { name: 'alice' }
        )
      ).toBe(true);
      expect(
        evaluateFilter(
          { type: 'comparison', field: 'name', operator: 'eq', value: 'alice' },
          { name: 'bob' }
        )
      ).toBe(false);
    });
  });

  describe('nested field access', () => {
    it('accesses nested fields with dot notation', () => {
      const doc = { user: { profile: { age: 25 } } };
      expect(
        evaluateFilter(
          { type: 'comparison', field: 'user.profile.age', operator: 'gte', value: 18 },
          doc
        )
      ).toBe(true);
    });

    it('returns undefined for missing nested paths', () => {
      const doc = { user: {} };
      expect(
        evaluateFilter(
          { type: 'comparison', field: 'user.profile.age', operator: 'eq', value: undefined },
          doc
        )
      ).toBe(true);
    });

    it('handles null in nested path', () => {
      const doc = { user: null } as unknown as Record<string, unknown>;
      expect(evaluateFilter({ type: 'exists', field: 'user.name', exists: true }, doc)).toBe(false);
    });
  });

  describe('logical filters', () => {
    it('AND requires all conditions', () => {
      const filter: LogicalFilter = {
        type: 'and',
        conditions: [
          { type: 'comparison', field: 'a', operator: 'eq', value: 1 },
          { type: 'comparison', field: 'b', operator: 'eq', value: 2 },
        ],
      };
      expect(evaluateFilter(filter, { a: 1, b: 2 })).toBe(true);
      expect(evaluateFilter(filter, { a: 1, b: 3 })).toBe(false);
    });

    it('OR requires any condition', () => {
      const filter: LogicalFilter = {
        type: 'or',
        conditions: [
          { type: 'comparison', field: 'a', operator: 'eq', value: 1 },
          { type: 'comparison', field: 'a', operator: 'eq', value: 2 },
        ],
      };
      expect(evaluateFilter(filter, { a: 1 })).toBe(true);
      expect(evaluateFilter(filter, { a: 2 })).toBe(true);
      expect(evaluateFilter(filter, { a: 3 })).toBe(false);
    });

    it('NOT inverts the result', () => {
      const filter: LogicalFilter = {
        type: 'not',
        conditions: [{ type: 'comparison', field: 'deleted', operator: 'eq', value: true }],
      };
      expect(evaluateFilter(filter, { deleted: false })).toBe(true);
      expect(evaluateFilter(filter, { deleted: true })).toBe(false);
    });
  });

  describe('exists filter', () => {
    it('exists=true passes when field is present', () => {
      expect(
        evaluateFilter({ type: 'exists', field: 'name', exists: true }, { name: 'Alice' })
      ).toBe(true);
    });

    it('exists=true fails when field is missing', () => {
      expect(evaluateFilter({ type: 'exists', field: 'name', exists: true }, {})).toBe(false);
    });

    it('exists=false passes when field is missing', () => {
      expect(evaluateFilter({ type: 'exists', field: 'name', exists: false }, {})).toBe(true);
    });

    it('exists=false fails when field is present', () => {
      expect(
        evaluateFilter({ type: 'exists', field: 'name', exists: false }, { name: 'Alice' })
      ).toBe(false);
    });
  });

  describe('in filter', () => {
    it('matches when value is in array', () => {
      expect(
        evaluateFilter(
          { type: 'in', field: 'role', values: ['admin', 'editor'] },
          { role: 'admin' }
        )
      ).toBe(true);
    });

    it('fails when value is not in array', () => {
      expect(
        evaluateFilter(
          { type: 'in', field: 'role', values: ['admin', 'editor'] },
          { role: 'viewer' }
        )
      ).toBe(false);
    });

    it('negate=true inverts the match', () => {
      expect(
        evaluateFilter(
          { type: 'in', field: 'role', values: ['admin'], negate: true },
          { role: 'viewer' }
        )
      ).toBe(true);
      expect(
        evaluateFilter(
          { type: 'in', field: 'role', values: ['admin'], negate: true },
          { role: 'admin' }
        )
      ).toBe(false);
    });
  });

  describe('time filter', () => {
    it('matches within since range (numeric)', () => {
      expect(evaluateFilter({ type: 'time', field: 'ts', since: 100 }, { ts: 200 })).toBe(true);
      expect(evaluateFilter({ type: 'time', field: 'ts', since: 100 }, { ts: 50 })).toBe(false);
    });

    it('matches within until range (numeric)', () => {
      expect(evaluateFilter({ type: 'time', field: 'ts', until: 500 }, { ts: 200 })).toBe(true);
      expect(evaluateFilter({ type: 'time', field: 'ts', until: 500 }, { ts: 600 })).toBe(false);
    });

    it('matches within since+until range', () => {
      const filter: TimeFilter = { type: 'time', field: 'ts', since: 100, until: 500 };
      expect(evaluateFilter(filter, { ts: 300 })).toBe(true);
      expect(evaluateFilter(filter, { ts: 50 })).toBe(false);
      expect(evaluateFilter(filter, { ts: 600 })).toBe(false);
    });

    it('handles string dates in field value', () => {
      const since = new Date('2024-01-01').getTime();
      expect(evaluateFilter({ type: 'time', field: 'date', since }, { date: '2024-06-15' })).toBe(
        true
      );
    });

    it('handles string since value', () => {
      expect(
        evaluateFilter(
          { type: 'time', field: 'date', since: '2024-01-01' },
          { date: new Date('2024-06-15').getTime() }
        )
      ).toBe(true);
    });

    it('returns false for non-date field values', () => {
      expect(evaluateFilter({ type: 'time', field: 'ts', since: 100 }, { ts: 'not-a-date' })).toBe(
        false
      );
    });

    it('returns false for missing field', () => {
      expect(evaluateFilter({ type: 'time', field: 'ts', since: 100 }, {})).toBe(false);
    });
  });

  describe('custom filter', () => {
    it('always returns true (evaluated externally)', () => {
      expect(evaluateFilter({ type: 'custom', name: 'my-filter', params: { x: 1 } }, {})).toBe(
        true
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Policy Evaluator — PolicyEvaluator class
// ═══════════════════════════════════════════════════════════

describe('PolicyEvaluator', () => {
  describe('evaluate', () => {
    it('returns shouldSync=false for unknown collection', () => {
      const evaluator = createPolicyEvaluator(minimalPolicy());
      const result = evaluator.evaluate('unknown', { id: 1 });
      expect(result.shouldSync).toBe(false);
      expect(result.direction).toBe('none');
      expect(result.reason).toContain('not in policy');
    });

    it('returns shouldSync=false for disabled collection', () => {
      const policy = minimalPolicy({
        collections: [
          { collection: 'items', direction: 'both', priority: 'normal', enabled: false },
        ],
      });
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { id: 1 });
      expect(result.shouldSync).toBe(false);
      expect(result.matchedRules).toContain('disabled');
    });

    it('returns shouldSync=true for matching doc without filter', () => {
      const evaluator = createPolicyEvaluator(minimalPolicy());
      const result = evaluator.evaluate('items', { id: 1 });
      expect(result.shouldSync).toBe(true);
      expect(result.direction).toBe('both');
      expect(result.priority).toBe('normal');
      expect(result.matchedRules).toContain('items');
    });

    it('returns shouldSync=false when doc fails filter', () => {
      const policy = minimalPolicy({
        collections: [
          {
            collection: 'items',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'comparison', field: 'status', operator: 'eq', value: 'active' },
          },
        ],
      });
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { status: 'deleted' });
      expect(result.shouldSync).toBe(false);
      expect(result.reason).toContain('did not pass');
    });

    it('returns shouldSync=true when doc passes filter', () => {
      const policy = minimalPolicy({
        collections: [
          {
            collection: 'items',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'comparison', field: 'status', operator: 'eq', value: 'active' },
          },
        ],
      });
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { status: 'active' });
      expect(result.shouldSync).toBe(true);
    });

    it('uses default conflictStrategy from globals', () => {
      const policy = minimalPolicy({
        globals: {
          defaultDirection: 'both',
          defaultPriority: 'normal',
          defaultConflictStrategy: 'server-wins',
          maxBatchSize: 100,
          maxDocumentSizeBytes: 1024,
          syncIntervalMs: 5000,
          enableCompression: true,
        },
      });
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { id: 1 });
      expect(result.conflictStrategy).toBe('server-wins');
    });

    it('uses collection conflictStrategy over global default', () => {
      const policy = minimalPolicy({
        collections: [
          {
            collection: 'items',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            conflictStrategy: 'merge',
          },
        ],
        globals: {
          defaultDirection: 'both',
          defaultPriority: 'normal',
          defaultConflictStrategy: 'server-wins',
          maxBatchSize: 100,
          maxDocumentSizeBytes: 1024,
          syncIntervalMs: 5000,
          enableCompression: true,
        },
      });
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { id: 1 });
      expect(result.conflictStrategy).toBe('merge');
    });

    it('defaults conflictStrategy to latest-wins', () => {
      const evaluator = createPolicyEvaluator(minimalPolicy());
      const result = evaluator.evaluate('items', { id: 1 });
      expect(result.conflictStrategy).toBe('latest-wins');
    });
  });

  describe('field projection', () => {
    it('returns filteredFields with include mode', () => {
      const policy = minimalPolicy({
        collections: [
          {
            collection: 'items',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            fields: { mode: 'include', fields: ['id', 'name'] },
          },
        ],
      });
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { id: 1, name: 'test', secret: 'hidden' });
      expect(result.filteredFields).toEqual(['id', 'name']);
    });

    it('returns filteredFields with exclude mode', () => {
      const policy = minimalPolicy({
        collections: [
          {
            collection: 'items',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            fields: { mode: 'exclude', fields: ['secret'] },
          },
        ],
      });
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { id: 1, name: 'test', secret: 'hidden' });
      expect(result.filteredFields).toEqual(['id', 'name']);
    });

    it('returns undefined filteredFields when no field policy', () => {
      const evaluator = createPolicyEvaluator(minimalPolicy());
      const result = evaluator.evaluate('items', { id: 1 });
      expect(result.filteredFields).toBeUndefined();
    });
  });

  describe('user scope matching', () => {
    function policyWithUserScopes(): SyncPolicyDefinition {
      return {
        name: 'scoped',
        version: 1,
        collections: [
          { collection: 'items', direction: 'both', priority: 'normal', enabled: true },
        ],
        userScopes: [
          {
            name: 'admin:items',
            condition: { roles: ['admin'] },
            overrides: { collection: 'items', priority: 'critical' },
          },
        ],
      };
    }

    it('applies override when user matches role', () => {
      const evaluator = createPolicyEvaluator(policyWithUserScopes());
      const result = evaluator.evaluate('items', { id: 1 }, { roles: ['admin'] });
      expect(result.priority).toBe('critical');
    });

    it('does not apply override when user does not match', () => {
      const evaluator = createPolicyEvaluator(policyWithUserScopes());
      const result = evaluator.evaluate('items', { id: 1 }, { roles: ['viewer'] });
      expect(result.priority).toBe('normal');
    });

    it('does not apply override when no user context', () => {
      const evaluator = createPolicyEvaluator(policyWithUserScopes());
      const result = evaluator.evaluate('items', { id: 1 });
      expect(result.priority).toBe('normal');
    });

    it('matches user with property conditions', () => {
      const policy: SyncPolicyDefinition = {
        name: 'prop-scoped',
        version: 1,
        collections: [
          { collection: 'items', direction: 'both', priority: 'normal', enabled: true },
        ],
        userScopes: [
          {
            name: 'premium:items',
            condition: { properties: { plan: 'premium' } },
            overrides: { collection: 'items', priority: 'high' },
          },
        ],
      };
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { id: 1 }, { properties: { plan: 'premium' } });
      expect(result.priority).toBe('high');
    });

    it('does not match user with wrong properties', () => {
      const policy: SyncPolicyDefinition = {
        name: 'prop-scoped',
        version: 1,
        collections: [
          { collection: 'items', direction: 'both', priority: 'normal', enabled: true },
        ],
        userScopes: [
          {
            name: 'premium:items',
            condition: { properties: { plan: 'premium' } },
            overrides: { collection: 'items', priority: 'high' },
          },
        ],
      };
      const evaluator = createPolicyEvaluator(policy);
      const result = evaluator.evaluate('items', { id: 1 }, { properties: { plan: 'free' } });
      expect(result.priority).toBe('normal');
    });

    it('matches on both roles AND properties', () => {
      const policy: SyncPolicyDefinition = {
        name: 'combo-scoped',
        version: 1,
        collections: [
          { collection: 'items', direction: 'both', priority: 'normal', enabled: true },
        ],
        userScopes: [
          {
            name: 'admin-premium:items',
            condition: { roles: ['admin'], properties: { plan: 'premium' } },
            overrides: { collection: 'items', priority: 'critical' },
          },
        ],
      };
      const evaluator = createPolicyEvaluator(policy);

      // Both match
      const r1 = evaluator.evaluate(
        'items',
        {},
        { roles: ['admin'], properties: { plan: 'premium' } }
      );
      expect(r1.priority).toBe('critical');

      // Only roles match
      const r2 = evaluator.evaluate(
        'items',
        {},
        { roles: ['admin'], properties: { plan: 'free' } }
      );
      expect(r2.priority).toBe('normal');

      // Only properties match
      const r3 = evaluator.evaluate(
        'items',
        {},
        { roles: ['viewer'], properties: { plan: 'premium' } }
      );
      expect(r3.priority).toBe('normal');
    });
  });

  describe('evaluateBatch', () => {
    it('separates docs into sync and skip', () => {
      const policy = minimalPolicy({
        collections: [
          {
            collection: 'items',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'comparison', field: 'active', operator: 'eq', value: true },
          },
        ],
      });
      const evaluator = createPolicyEvaluator(policy);
      const docs = [
        { id: 1, active: true },
        { id: 2, active: false },
        { id: 3, active: true },
      ];
      const { sync, skip } = evaluator.evaluateBatch('items', docs);
      expect(sync).toHaveLength(2);
      expect(skip).toHaveLength(1);
      expect(skip[0]).toEqual({ id: 2, active: false });
    });

    it('applies field projection in batch', () => {
      const policy = minimalPolicy({
        collections: [
          {
            collection: 'items',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            fields: { mode: 'include', fields: ['id', 'name'] },
          },
        ],
      });
      const evaluator = createPolicyEvaluator(policy);
      const docs = [{ id: 1, name: 'test', secret: 'hidden' }];
      const { sync } = evaluator.evaluateBatch('items', docs);
      expect(sync[0]).toEqual({ id: 1, name: 'test' });
      expect(sync[0]).not.toHaveProperty('secret');
    });

    it('skips all docs for unknown collection', () => {
      const evaluator = createPolicyEvaluator(minimalPolicy());
      const { sync, skip } = evaluator.evaluateBatch('unknown', [{ id: 1 }]);
      expect(sync).toHaveLength(0);
      expect(skip).toHaveLength(1);
    });

    it('handles empty docs array', () => {
      const evaluator = createPolicyEvaluator(minimalPolicy());
      const { sync, skip } = evaluator.evaluateBatch('items', []);
      expect(sync).toHaveLength(0);
      expect(skip).toHaveLength(0);
    });

    it('passes user context to batch evaluation', () => {
      const policy: SyncPolicyDefinition = {
        name: 'batch-scoped',
        version: 1,
        collections: [
          { collection: 'items', direction: 'both', priority: 'normal', enabled: true },
        ],
        userScopes: [
          {
            name: 'admin:items',
            condition: { roles: ['admin'] },
            overrides: { collection: 'items', enabled: false },
          },
        ],
      };
      const evaluator = createPolicyEvaluator(policy);
      const docs = [{ id: 1 }, { id: 2 }];

      // Admin user: collection disabled via override
      const adminResult = evaluator.evaluateBatch('items', docs, { roles: ['admin'] });
      expect(adminResult.sync).toHaveLength(0);
      expect(adminResult.skip).toHaveLength(2);

      // Regular user: collection enabled
      const regularResult = evaluator.evaluateBatch('items', docs, { roles: ['viewer'] });
      expect(regularResult.sync).toHaveLength(2);
    });
  });

  describe('getSyncOrder', () => {
    it('returns collections sorted by priority', () => {
      const policy: SyncPolicyDefinition = {
        name: 'ordered',
        version: 1,
        collections: [
          { collection: 'low', direction: 'both', priority: 'low', enabled: true },
          { collection: 'critical', direction: 'both', priority: 'critical', enabled: true },
          { collection: 'normal', direction: 'both', priority: 'normal', enabled: true },
          { collection: 'high', direction: 'both', priority: 'high', enabled: true },
          { collection: 'bg', direction: 'both', priority: 'background', enabled: true },
        ],
      };
      const evaluator = createPolicyEvaluator(policy);
      expect(evaluator.getSyncOrder()).toEqual(['critical', 'high', 'normal', 'low', 'bg']);
    });

    it('excludes disabled collections from sync order', () => {
      const policy: SyncPolicyDefinition = {
        name: 'ordered',
        version: 1,
        collections: [
          { collection: 'enabled', direction: 'both', priority: 'normal', enabled: true },
          { collection: 'disabled', direction: 'both', priority: 'critical', enabled: false },
        ],
      };
      const evaluator = createPolicyEvaluator(policy);
      expect(evaluator.getSyncOrder()).toEqual(['enabled']);
    });

    it('returns empty array for all disabled', () => {
      const policy: SyncPolicyDefinition = {
        name: 'empty',
        version: 1,
        collections: [{ collection: 'a', direction: 'both', priority: 'normal', enabled: false }],
      };
      const evaluator = createPolicyEvaluator(policy);
      expect(evaluator.getSyncOrder()).toEqual([]);
    });
  });

  describe('createPolicyEvaluator factory', () => {
    it('creates a PolicyEvaluator instance', () => {
      const evaluator = createPolicyEvaluator(minimalPolicy());
      expect(evaluator).toBeInstanceOf(PolicyEvaluator);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Policy Validator
// ═══════════════════════════════════════════════════════════

describe('Policy Validator', () => {
  describe('validatePolicy — valid policies', () => {
    it('validates a minimal policy', () => {
      const result = validatePolicy(minimalPolicy());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a fully built policy', () => {
      const policy = syncPolicy('full')
        .description('Full policy')
        .version(2)
        .collection('messages')
        .direction('both')
        .priority('high')
        .filter((f) => f.field('status').eq('active'))
        .includeFields('id', 'text')
        .conflictStrategy('merge')
        .batchSize(50)
        .rateLimit(60)
        .ttl(30000)
        .done()
        .collection('files')
        .direction('pull')
        .priority('low')
        .done()
        .defaults({ maxBatchSize: 200 })
        .bandwidth({ mode: 'metered', maxBytesPerSync: 5_000_000 })
        .userScope('admin', (u) => u.roles('admin').override('messages', { priority: 'critical' }))
        .build();

      const result = validatePolicy(policy);
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePolicy — invalid policies', () => {
    it('rejects missing name', () => {
      const result = validatePolicy({ ...minimalPolicy(), name: '' });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'name')).toBe(true);
    });

    it('rejects version < 1', () => {
      const result = validatePolicy({ ...minimalPolicy(), version: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'version')).toBe(true);
    });

    it('rejects empty collections', () => {
      const result = validatePolicy({ ...minimalPolicy(), collections: [] });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === 'collections')).toBe(true);
    });

    it('rejects duplicate collection names', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          { collection: 'dup', direction: 'both', priority: 'normal', enabled: true },
          { collection: 'dup', direction: 'pull', priority: 'high', enabled: true },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
    });

    it('rejects empty collection name', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [{ collection: '', direction: 'both', priority: 'normal', enabled: true }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Collection name is required'))).toBe(
        true
      );
    });

    it('rejects invalid direction', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          { collection: 'c', direction: 'invalid' as any, priority: 'normal', enabled: true },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Invalid direction'))).toBe(true);
    });

    it('rejects invalid priority', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          { collection: 'c', direction: 'both', priority: 'invalid' as any, enabled: true },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Invalid priority'))).toBe(true);
    });

    it('rejects negative batchSize', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          { collection: 'c', direction: 'both', priority: 'normal', enabled: true, batchSize: 0 },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Batch size'))).toBe(true);
    });

    it('rejects negative rateLimit', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          { collection: 'c', direction: 'both', priority: 'normal', enabled: true, rateLimit: 0 },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Rate limit'))).toBe(true);
    });

    it('rejects negative maxBytesPerSync', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        bandwidthConfig: { mode: 'metered', maxBytesPerSync: -1 },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('maxBytesPerSync'))).toBe(true);
    });
  });

  describe('validatePolicy — warnings', () => {
    it('warns on direction=none with enabled=true', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [{ collection: 'c', direction: 'none', priority: 'normal', enabled: true }],
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes('direction "none"'))).toBe(true);
    });

    it('warns on empty field policy fields', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            fields: { mode: 'include', fields: [] },
          },
        ],
      });
      expect(result.warnings.some((w) => w.message.includes('no fields'))).toBe(true);
    });
  });

  describe('validatePolicy — filter validation', () => {
    it('rejects comparison filter without field', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'comparison', field: '', operator: 'eq', value: 1 },
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('Comparison filter requires a field'))
      ).toBe(true);
    });

    it('rejects and filter with no conditions', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'and', conditions: [] },
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('and filter requires at least one condition'))
      ).toBe(true);
    });

    it('rejects or filter with no conditions', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'or', conditions: [] },
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects not filter with no conditions', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'not', conditions: [] },
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects in filter without field', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'in', field: '', values: [1] },
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects in filter without values', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'in', field: 'x', values: [] },
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('In filter requires values'))).toBe(true);
    });

    it('rejects exists filter without field', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'exists', field: '', exists: true },
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects time filter without since or until', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'time', field: 'ts' } as any,
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('since'))).toBe(true);
    });

    it('rejects time filter without field', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: { type: 'time', field: '', since: 100 },
          },
        ],
      });
      expect(result.valid).toBe(false);
    });

    it('validates nested filter expressions recursively', () => {
      const result = validatePolicy({
        ...minimalPolicy(),
        collections: [
          {
            collection: 'c',
            direction: 'both',
            priority: 'normal',
            enabled: true,
            filter: {
              type: 'and',
              conditions: [
                { type: 'comparison', field: 'a', operator: 'eq', value: 1 },
                { type: 'in', field: '', values: [1] }, // invalid nested
              ],
            },
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('conditions[1]'))).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Serialization
// ═══════════════════════════════════════════════════════════

describe('Serialization', () => {
  describe('serializePolicy', () => {
    it('serializes to JSON string', () => {
      const policy = minimalPolicy();
      const json = serializePolicy(policy);
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.name).toBe('test-policy');
    });

    it('produces pretty-printed JSON', () => {
      const json = serializePolicy(minimalPolicy());
      expect(json).toContain('\n');
    });
  });

  describe('deserializePolicy', () => {
    it('deserializes a valid policy', () => {
      const original = minimalPolicy();
      const json = serializePolicy(original);
      const restored = deserializePolicy(json);
      expect(restored).toEqual(original);
    });

    it('throws on invalid JSON', () => {
      expect(() => deserializePolicy('not json')).toThrow();
    });

    it('throws on invalid policy (missing name)', () => {
      const json = JSON.stringify({
        name: '',
        version: 1,
        collections: [{ collection: 'c', direction: 'both', priority: 'normal', enabled: true }],
      });
      expect(() => deserializePolicy(json)).toThrow('Invalid policy');
    });

    it('throws on invalid policy (bad version)', () => {
      const json = JSON.stringify({
        name: 'x',
        version: 0,
        collections: [{ collection: 'c', direction: 'both', priority: 'normal', enabled: true }],
      });
      expect(() => deserializePolicy(json)).toThrow('Invalid policy');
    });

    it('throws on invalid policy (no collections)', () => {
      const json = JSON.stringify({ name: 'x', version: 1, collections: [] });
      expect(() => deserializePolicy(json)).toThrow('Invalid policy');
    });
  });

  describe('round-trip', () => {
    it('round-trips a complex policy built with DSL', () => {
      const original = syncPolicy('round-trip-test')
        .description('Test round-trip serialization')
        .version(3)
        .collection('messages')
        .direction('both')
        .priority('high')
        .filter((f) => f.field('status').eq('active'))
        .includeFields('id', 'text', 'author')
        .conflictStrategy('merge')
        .batchSize(100)
        .rateLimit(60)
        .ttl(60000)
        .done()
        .collection('files')
        .direction('pull')
        .priority('low')
        .filter((f) =>
          f.and(
            (g) => g.field('size').lt(1024 * 1024),
            (g) => g.field('type').in(['image', 'document'])
          )
        )
        .excludeFields('rawData')
        .done()
        .defaults({ maxBatchSize: 200, enableCompression: true })
        .bandwidth({ mode: 'metered', maxBytesPerSync: 10_000_000, throttleMs: 500 })
        .userScope('admin', (u) => u.roles('admin').override('messages', { priority: 'critical' }))
        .build();

      const json = serializePolicy(original);
      const restored = deserializePolicy(json);
      expect(restored).toEqual(original);
    });

    it('round-trips policy with time filter', () => {
      const original = syncPolicy('time-test')
        .collection('events')
        .filter((f) => f.since('createdAt', 1000))
        .done()
        .build();

      const json = serializePolicy(original);
      const restored = deserializePolicy(json);
      expect(restored).toEqual(original);
    });

    it('round-trips policy with custom filter', () => {
      const original = syncPolicy('custom-test')
        .collection('geo')
        .filter((f) => f.custom('geo-fence', { lat: 40, lng: -74, radius: 5 }))
        .done()
        .build();

      const json = serializePolicy(original);
      const restored = deserializePolicy(json);
      expect(restored).toEqual(original);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('evaluates a policy with no filter and no field policy', () => {
    const evaluator = createPolicyEvaluator(minimalPolicy());
    const result = evaluator.evaluate('items', { id: 1, data: 'anything' });
    expect(result.shouldSync).toBe(true);
    expect(result.filteredFields).toBeUndefined();
  });

  it('handles doc with no matching fields for include projection', () => {
    const policy = minimalPolicy({
      collections: [
        {
          collection: 'items',
          direction: 'both',
          priority: 'normal',
          enabled: true,
          fields: { mode: 'include', fields: ['nonexistent'] },
        },
      ],
    });
    const evaluator = createPolicyEvaluator(policy);
    const { sync } = evaluator.evaluateBatch('items', [{ id: 1 }]);
    expect(sync[0]).toEqual({});
  });

  it('handles exclude projection that removes all fields', () => {
    const policy = minimalPolicy({
      collections: [
        {
          collection: 'items',
          direction: 'both',
          priority: 'normal',
          enabled: true,
          fields: { mode: 'exclude', fields: ['id', 'name'] },
        },
      ],
    });
    const evaluator = createPolicyEvaluator(policy);
    const { sync } = evaluator.evaluateBatch('items', [{ id: 1, name: 'test' }]);
    expect(sync[0]).toEqual({});
  });

  it('evaluates deeply nested AND/OR filter combination', () => {
    const filter: FilterExpression = {
      type: 'and',
      conditions: [
        {
          type: 'or',
          conditions: [
            { type: 'comparison', field: 'type', operator: 'eq', value: 'A' },
            { type: 'comparison', field: 'type', operator: 'eq', value: 'B' },
          ],
        },
        {
          type: 'not',
          conditions: [{ type: 'comparison', field: 'deleted', operator: 'eq', value: true }],
        },
        {
          type: 'exists',
          field: 'name',
          exists: true,
        },
      ],
    };

    expect(evaluateFilter(filter, { type: 'A', deleted: false, name: 'test' })).toBe(true);
    expect(evaluateFilter(filter, { type: 'C', deleted: false, name: 'test' })).toBe(false);
    expect(evaluateFilter(filter, { type: 'A', deleted: true, name: 'test' })).toBe(false);
    expect(evaluateFilter(filter, { type: 'A', deleted: false })).toBe(false);
  });

  it('handles multiple validation errors at once', () => {
    const result = validatePolicy({
      name: '',
      version: 0,
      collections: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('full DSL integration: build, validate, serialize, deserialize, evaluate', () => {
    const policy = syncPolicy('integration')
      .collection('tasks')
      .direction('both')
      .priority('high')
      .filter((f) => f.field('status').ne('deleted'))
      .includeFields('id', 'title', 'status')
      .conflictStrategy('latest-wins')
      .done()
      .build();

    // Validate
    const validation = validatePolicy(policy);
    expect(validation.valid).toBe(true);

    // Serialize & Deserialize
    const json = serializePolicy(policy);
    const restored = deserializePolicy(json);
    expect(restored).toEqual(policy);

    // Evaluate
    const evaluator = createPolicyEvaluator(restored);
    const active = evaluator.evaluate('tasks', {
      id: 1,
      title: 'Test',
      status: 'active',
      secret: 'x',
    });
    expect(active.shouldSync).toBe(true);
    expect(active.filteredFields).toEqual(['id', 'title', 'status']);

    const deleted = evaluator.evaluate('tasks', { id: 2, title: 'Old', status: 'deleted' });
    expect(deleted.shouldSync).toBe(false);

    // Batch
    const { sync, skip } = evaluator.evaluateBatch('tasks', [
      { id: 1, title: 'A', status: 'active', extra: 'no' },
      { id: 2, title: 'B', status: 'deleted', extra: 'no' },
    ]);
    expect(sync).toHaveLength(1);
    expect(sync[0]).toEqual({ id: 1, title: 'A', status: 'active' });
    expect(skip).toHaveLength(1);
  });
});
