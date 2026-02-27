import { describe, expect, it } from 'vitest';
import type { PolicySet, RLSContext } from '../policy-dsl.js';
import {
  PolicyDSL,
  PolicyEvaluator,
  createPolicyDSL,
  createPolicyEvaluator,
} from '../policy-dsl.js';
import type { SyncRLS } from '../sync-rls.js';
import { createSyncRLS } from '../sync-rls.js';

// ── Helpers ──────────────────────────────────────────────

function makeContext(overrides: Partial<RLSContext> = {}): RLSContext {
  return {
    userId: 'user-1',
    roles: ['member'],
    tenantId: 'tenant-1',
    attributes: {},
    ...overrides,
  };
}

// ── PolicyDSL Builder ────────────────────────────────────

describe('PolicyDSL', () => {
  it('creates a valid policy set with builder', () => {
    const policySet = createPolicyDSL('test-policies')
      .setDescription('Test policy set')
      .setDefaultEffect('deny')
      .setVersion(2)
      .allow('read')
      .id('read-all')
      .named('Read All')
      .described('Allow reading all documents')
      .on('posts')
      .withPriority(10)
      .done()
      .build();

    expect(policySet.name).toBe('test-policies');
    expect(policySet.description).toBe('Test policy set');
    expect(policySet.defaultEffect).toBe('deny');
    expect(policySet.version).toBe(2);
    expect(policySet.rules).toHaveLength(1);
    expect(policySet.rules[0].id).toBe('read-all');
    expect(policySet.rules[0].name).toBe('Read All');
    expect(policySet.rules[0].actions).toEqual(['read']);
    expect(policySet.rules[0].collections).toEqual(['posts']);
    expect(policySet.rules[0].priority).toBe(10);
    expect(policySet.rules[0].enabled).toBe(true);
  });

  it('supports multiple rules via chaining', () => {
    const policySet = PolicyDSL.create('multi')
      .allow('read')
      .on('docs')
      .done()
      .deny('delete')
      .on('docs')
      .forRoles('viewer')
      .done()
      .build();

    expect(policySet.rules).toHaveLength(2);
    expect(policySet.rules[0].effect).toBe('allow');
    expect(policySet.rules[1].effect).toBe('deny');
  });

  it('supports disabled rules', () => {
    const policySet = createPolicyDSL('disabled-test')
      .allow('read')
      .on('posts')
      .disabled()
      .done()
      .build();

    expect(policySet.rules[0].enabled).toBe(false);
  });

  it('supports tenant isolation shorthand', () => {
    const policySet = createPolicyDSL('tenant').tenantIsolation('orgId').build();

    expect(policySet.rules).toHaveLength(1);
    expect(policySet.rules[0].id).toBe('tenant-isolation-orgId');
    expect(policySet.rules[0].conditions[0].field).toBe('orgId');
    expect(policySet.rules[0].conditions[0].contextRef).toBe(true);
  });

  it('supports owner-only shorthand', () => {
    const policySet = createPolicyDSL('owner').ownerOnly('createdBy').build();

    expect(policySet.rules).toHaveLength(1);
    expect(policySet.rules[0].id).toBe('owner-only-createdBy');
    expect(policySet.rules[0].conditions[0].field).toBe('createdBy');
    expect(policySet.rules[0].conditions[0].value).toBe('userId');
    expect(policySet.rules[0].conditions[0].contextRef).toBe(true);
  });

  it('supports allowRoles shorthand', () => {
    const policySet = createPolicyDSL('roles')
      .allowRoles('admin', 'superadmin')
      .on('settings')
      .done()
      .build();

    expect(policySet.rules).toHaveLength(1);
    expect(policySet.rules[0].actions).toEqual(['*']);
    expect(policySet.rules[0].roles).toEqual(['admin', 'superadmin']);
  });
});

// ── PolicyEvaluator ──────────────────────────────────────

describe('PolicyEvaluator', () => {
  it('allows when rule matches', () => {
    const ps = createPolicyDSL('test')
      .setDefaultEffect('deny')
      .allow('read')
      .on('posts')
      .where('status', '$eq', 'published')
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    expect(evaluator.evaluate('read', 'posts', { status: 'published' }, makeContext())).toBe(true);
    expect(evaluator.evaluate('read', 'posts', { status: 'draft' }, makeContext())).toBe(false);
  });

  it('denies when deny rule matches', () => {
    const ps = createPolicyDSL('test')
      .setDefaultEffect('allow')
      .deny('delete')
      .on('posts')
      .where('locked', '$eq', true)
      .withPriority(100)
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    expect(evaluator.evaluate('delete', 'posts', { locked: true }, makeContext())).toBe(false);
    expect(evaluator.evaluate('delete', 'posts', { locked: false }, makeContext())).toBe(true);
  });

  it('falls back to default effect when no rules match', () => {
    const psAllow = createPolicyDSL('allow-default').setDefaultEffect('allow').build();
    const psDeny = createPolicyDSL('deny-default').setDefaultEffect('deny').build();

    expect(createPolicyEvaluator(psAllow).evaluate('read', 'any', {}, makeContext())).toBe(true);
    expect(createPolicyEvaluator(psDeny).evaluate('read', 'any', {}, makeContext())).toBe(false);
  });

  it('enforces role-based access control', () => {
    const ps = createPolicyDSL('rbac')
      .setDefaultEffect('deny')
      .allow('*')
      .on('admin-panel')
      .forRoles('admin')
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    expect(evaluator.evaluate('read', 'admin-panel', {}, makeContext({ roles: ['admin'] }))).toBe(
      true
    );
    expect(evaluator.evaluate('read', 'admin-panel', {}, makeContext({ roles: ['member'] }))).toBe(
      false
    );
  });

  it('evaluates tenant isolation correctly', () => {
    const ps = createPolicyDSL('tenant-test')
      .setDefaultEffect('deny')
      .tenantIsolation('tenantId')
      .build();

    const evaluator = createPolicyEvaluator(ps);
    const ctx = makeContext({ tenantId: 'tenant-A' });

    expect(evaluator.evaluate('read', 'orders', { tenantId: 'tenant-A' }, ctx)).toBe(true);
    expect(evaluator.evaluate('read', 'orders', { tenantId: 'tenant-B' }, ctx)).toBe(false);
  });

  it('evaluates owner-only pattern correctly', () => {
    const ps = createPolicyDSL('owner-test').setDefaultEffect('deny').ownerOnly('ownerId').build();

    const evaluator = createPolicyEvaluator(ps);
    const ctx = makeContext({ userId: 'user-42' });

    expect(evaluator.evaluate('update', 'docs', { ownerId: 'user-42' }, ctx)).toBe(true);
    expect(evaluator.evaluate('update', 'docs', { ownerId: 'user-99' }, ctx)).toBe(false);
  });

  it('resolves context references in conditions', () => {
    const ps = createPolicyDSL('ctx-ref')
      .setDefaultEffect('deny')
      .allow('read')
      .on('items')
      .whereContext('department', '$eq', 'attributes.department')
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    const ctx = makeContext({ attributes: { department: 'engineering' } });

    expect(evaluator.evaluate('read', 'items', { department: 'engineering' }, ctx)).toBe(true);
    expect(evaluator.evaluate('read', 'items', { department: 'marketing' }, ctx)).toBe(false);
  });

  it('evaluates priority ordering (higher priority first)', () => {
    const ps = createPolicyDSL('priority-test')
      .setDefaultEffect('deny')
      .deny('read')
      .on('docs')
      .withPriority(100)
      .done()
      .allow('read')
      .on('docs')
      .withPriority(50)
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    // Higher priority deny rule (100) should be evaluated before allow (50)
    expect(evaluator.evaluate('read', 'docs', {}, makeContext())).toBe(false);
  });

  it('skips higher priority rule when conditions do not match and evaluates next', () => {
    const ps = createPolicyDSL('priority-fallthrough')
      .setDefaultEffect('deny')
      .deny('read')
      .on('docs')
      .where('secret', '$eq', true)
      .withPriority(100)
      .done()
      .allow('read')
      .on('docs')
      .withPriority(50)
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    // Deny has higher priority but condition doesn't match → falls through to allow
    expect(evaluator.evaluate('read', 'docs', { secret: false }, makeContext())).toBe(true);
    // Deny matches
    expect(evaluator.evaluate('read', 'docs', { secret: true }, makeContext())).toBe(false);
  });

  it('skips disabled rules', () => {
    const ps = createPolicyDSL('disabled')
      .setDefaultEffect('deny')
      .allow('read')
      .on('posts')
      .disabled()
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    expect(evaluator.evaluate('read', 'posts', {}, makeContext())).toBe(false);
  });

  it('filters documents in batch', () => {
    const ps = createPolicyDSL('batch')
      .setDefaultEffect('deny')
      .tenantIsolation('tenantId')
      .build();

    const evaluator = createPolicyEvaluator(ps);
    const ctx = makeContext({ tenantId: 'T1' });

    const docs = [
      { id: '1', tenantId: 'T1' },
      { id: '2', tenantId: 'T2' },
      { id: '3', tenantId: 'T1' },
      { id: '4', tenantId: 'T3' },
    ];

    const filtered = evaluator.filter('read', 'items', docs, ctx);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((d) => d.id)).toEqual(['1', '3']);
  });

  it('generates query filters from policy conditions', () => {
    const ps = createPolicyDSL('filter-gen')
      .setDefaultEffect('deny')
      .tenantIsolation('tenantId')
      .build();

    const evaluator = createPolicyEvaluator(ps);
    const ctx = makeContext({ tenantId: 'tenant-X' });

    const filter = evaluator.generateQueryFilter('read', 'orders', ctx);
    expect(filter).toEqual({ tenantId: 'tenant-X' });
  });

  it('generates query filters with non-eq operators', () => {
    const ps = createPolicyDSL('complex-filter')
      .setDefaultEffect('deny')
      .allow('read')
      .on('items')
      .where('status', '$in', ['active', 'pending'])
      .done()
      .build();

    const evaluator = createPolicyEvaluator(ps);
    const filter = evaluator.generateQueryFilter('read', 'items', makeContext());
    expect(filter).toEqual({ status: { $in: ['active', 'pending'] } });
  });

  describe('operator coverage', () => {
    function evalOp(operator: string, docValue: unknown, compareValue: unknown): boolean {
      const ps: PolicySet = {
        name: 'op-test',
        defaultEffect: 'deny',
        rules: [
          {
            id: 'r1',
            name: 'r1',
            effect: 'allow',
            actions: ['read'],
            collections: ['c'],
            conditions: [{ field: 'f', operator: operator as any, value: compareValue }],
            priority: 50,
            enabled: true,
          },
        ],
        version: 1,
      };
      return new PolicyEvaluator(ps).evaluate('read', 'c', { f: docValue }, makeContext());
    }

    it('$ne', () => {
      expect(evalOp('$ne', 'a', 'b')).toBe(true);
      expect(evalOp('$ne', 'a', 'a')).toBe(false);
    });

    it('$gt / $gte', () => {
      expect(evalOp('$gt', 10, 5)).toBe(true);
      expect(evalOp('$gt', 5, 5)).toBe(false);
      expect(evalOp('$gte', 5, 5)).toBe(true);
    });

    it('$lt / $lte', () => {
      expect(evalOp('$lt', 3, 5)).toBe(true);
      expect(evalOp('$lt', 5, 5)).toBe(false);
      expect(evalOp('$lte', 5, 5)).toBe(true);
    });

    it('$in / $nin', () => {
      expect(evalOp('$in', 'a', ['a', 'b'])).toBe(true);
      expect(evalOp('$in', 'c', ['a', 'b'])).toBe(false);
      expect(evalOp('$nin', 'c', ['a', 'b'])).toBe(true);
      expect(evalOp('$nin', 'a', ['a', 'b'])).toBe(false);
    });

    it('$exists', () => {
      expect(evalOp('$exists', 'something', true)).toBe(true);
      expect(evalOp('$exists', undefined, true)).toBe(false);
      expect(evalOp('$exists', undefined, false)).toBe(true);
    });

    it('$regex', () => {
      expect(evalOp('$regex', 'hello-world', '^hello')).toBe(true);
      expect(evalOp('$regex', 'goodbye', '^hello')).toBe(false);
    });

    it('$contains', () => {
      expect(evalOp('$contains', ['a', 'b', 'c'], 'b')).toBe(true);
      expect(evalOp('$contains', ['a', 'b'], 'z')).toBe(false);
    });
  });
});

// ── SyncRLS ──────────────────────────────────────────────

describe('SyncRLS', () => {
  function buildSyncRLS(ctx: RLSContext): SyncRLS {
    const ps = createPolicyDSL('sync-policies')
      .setDefaultEffect('deny')
      .tenantIsolation('tenantId')
      .build();

    return createSyncRLS({ policies: ps, getContext: () => ctx });
  }

  it('generates sync filters for collections', () => {
    const ctx = makeContext({ tenantId: 'T1' });
    const sync = buildSyncRLS(ctx);

    const filters = sync.generateSyncFilters(['orders', 'invoices']);
    expect(filters).toHaveLength(2);
    expect(filters[0].collection).toBe('orders');
    expect(filters[0].filter).toEqual({ tenantId: 'T1' });
    expect(filters[1].collection).toBe('invoices');
  });

  it('shouldSync returns true for authorized documents', () => {
    const ctx = makeContext({ tenantId: 'T1' });
    const sync = buildSyncRLS(ctx);

    expect(sync.shouldSync('orders', { tenantId: 'T1' })).toBe(true);
    expect(sync.shouldSync('orders', { tenantId: 'T2' })).toBe(false);
  });

  it('filters sync payload', () => {
    const ctx = makeContext({ tenantId: 'T1' });
    const sync = buildSyncRLS(ctx);

    const docs = [
      { id: '1', tenantId: 'T1' },
      { id: '2', tenantId: 'T2' },
      { id: '3', tenantId: 'T1' },
    ];

    const filtered = sync.filterSyncPayload('orders', docs);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((d) => d.id)).toEqual(['1', '3']);
  });

  it('validates sync writes', () => {
    const ctx = makeContext({ tenantId: 'T1' });
    const sync = buildSyncRLS(ctx);

    expect(sync.validateSyncWrite('orders', { tenantId: 'T1' }, 'create')).toBe(true);
    expect(sync.validateSyncWrite('orders', { tenantId: 'T2' }, 'update')).toBe(false);
  });
});
