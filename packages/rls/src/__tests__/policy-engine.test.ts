import { describe, it, expect, beforeEach } from 'vitest';
import { createPolicyEngine, PolicyEngine } from '../policy-engine.js';
import type { AuthContext, Policy, RLSConfig } from '../types.js';

describe('PolicyEngine', () => {
  let engine: PolicyEngine;
  let authContext: AuthContext;

  const readPolicy: Policy = {
    name: 'allow-read',
    collection: 'todos',
    actions: ['read'],
    effect: 'allow',
    conditions: [{ field: 'status', operator: '$eq', value: 'published' }],
    priority: 10,
  };

  const denyDeletePolicy: Policy = {
    name: 'deny-delete',
    collection: 'todos',
    actions: ['delete'],
    effect: 'deny',
    conditions: [],
    priority: 20,
  };

  beforeEach(() => {
    engine = createPolicyEngine({
      policies: [readPolicy, denyDeletePolicy],
      defaultEffect: 'deny',
      enableTenantIsolation: false,
    });

    authContext = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['member'],
      metadata: {},
    };
  });

  describe('policy evaluation', () => {
    it('should allow action when policy conditions match with allow effect', () => {
      const doc = { _id: 'doc-1', status: 'published' };
      const result = engine.evaluate('read', 'todos', doc, authContext);

      expect(result.allowed).toBe(true);
      expect(result.matchedPolicy?.name).toBe('allow-read');
    });

    it('should deny action when policy has deny effect', () => {
      const doc = { _id: 'doc-1', status: 'published' };
      const result = engine.evaluate('delete', 'todos', doc, authContext);

      expect(result.allowed).toBe(false);
      expect(result.matchedPolicy?.name).toBe('deny-delete');
    });

    it('should deny action when no conditions match and default is deny', () => {
      const doc = { _id: 'doc-1', status: 'draft' };
      const result = engine.evaluate('read', 'todos', doc, authContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('No policy conditions matched');
    });

    it('should allow action when no policies match and default is allow', () => {
      const permissiveEngine = createPolicyEngine({
        defaultEffect: 'allow',
        enableTenantIsolation: false,
      });

      const doc = { _id: 'doc-1' };
      const result = permissiveEngine.evaluate('read', 'todos', doc, authContext);

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('No matching policies');
    });
  });

  describe('multiple policies with priority ordering', () => {
    it('should match higher priority policy first', () => {
      const lowPriority: Policy = {
        name: 'low-priority-allow',
        collection: 'notes',
        actions: ['read'],
        effect: 'allow',
        conditions: [],
        priority: 1,
      };

      const highPriority: Policy = {
        name: 'high-priority-deny',
        collection: 'notes',
        actions: ['read'],
        effect: 'deny',
        conditions: [],
        priority: 100,
      };

      const priorityEngine = createPolicyEngine({
        policies: [lowPriority, highPriority],
        defaultEffect: 'allow',
        enableTenantIsolation: false,
      });

      const doc = { _id: 'note-1' };
      const result = priorityEngine.evaluate('read', 'notes', doc, authContext);

      expect(result.allowed).toBe(false);
      expect(result.matchedPolicy?.name).toBe('high-priority-deny');
    });
  });

  describe('condition evaluation', () => {
    it('should evaluate $eq condition', () => {
      const policy: Policy = {
        name: 'eq-test',
        collection: 'items',
        actions: ['read'],
        effect: 'allow',
        conditions: [{ field: 'category', operator: '$eq', value: 'books' }],
        priority: 10,
      };

      const eng = createPolicyEngine({
        policies: [policy],
        defaultEffect: 'deny',
        enableTenantIsolation: false,
      });

      expect(
        eng.evaluate('read', 'items', { _id: '1', category: 'books' }, authContext).allowed,
      ).toBe(true);
      expect(
        eng.evaluate('read', 'items', { _id: '2', category: 'movies' }, authContext).allowed,
      ).toBe(false);
    });

    it('should evaluate $in condition', () => {
      const policy: Policy = {
        name: 'in-test',
        collection: 'items',
        actions: ['read'],
        effect: 'allow',
        conditions: [{ field: 'status', operator: '$in', value: ['active', 'pending'] }],
        priority: 10,
      };

      const eng = createPolicyEngine({
        policies: [policy],
        defaultEffect: 'deny',
        enableTenantIsolation: false,
      });

      expect(
        eng.evaluate('read', 'items', { _id: '1', status: 'active' }, authContext).allowed,
      ).toBe(true);
      expect(
        eng.evaluate('read', 'items', { _id: '2', status: 'archived' }, authContext).allowed,
      ).toBe(false);
    });

    it('should evaluate $exists condition', () => {
      const policy: Policy = {
        name: 'exists-test',
        collection: 'items',
        actions: ['read'],
        effect: 'allow',
        conditions: [{ field: 'metadata', operator: '$exists', value: true }],
        priority: 10,
      };

      const eng = createPolicyEngine({
        policies: [policy],
        defaultEffect: 'deny',
        enableTenantIsolation: false,
      });

      expect(
        eng.evaluate('read', 'items', { _id: '1', metadata: { key: 'val' } }, authContext).allowed,
      ).toBe(true);
      expect(
        eng.evaluate('read', 'items', { _id: '2' }, authContext).allowed,
      ).toBe(false);
    });
  });

  describe('query filter building', () => {
    it('should build filter from policy conditions', () => {
      const filter = engine.buildQueryFilter('read', 'todos', authContext);

      expect(filter).toHaveProperty('status', 'published');
    });

    it('should include tenant filter when tenant isolation is enabled', () => {
      const tenantEngine = createPolicyEngine({
        policies: [readPolicy],
        defaultEffect: 'deny',
        enableTenantIsolation: true,
        tenantField: '_tenantId',
      });

      const filter = tenantEngine.buildQueryFilter('read', 'todos', authContext);

      expect(filter).toHaveProperty('_tenantId', 'tenant-1');
      expect(filter).toHaveProperty('status', 'published');
    });

    it('should return empty filter when no policies match', () => {
      const filter = engine.buildQueryFilter('read', 'unknown-collection', authContext);

      expect(filter).toEqual({});
    });
  });

  describe('default effect', () => {
    it('should use deny as default when no policies match', () => {
      const denyEngine = createPolicyEngine({
        defaultEffect: 'deny',
        enableTenantIsolation: false,
      });

      const result = denyEngine.evaluate('read', 'anything', { _id: '1' }, authContext);
      expect(result.allowed).toBe(false);
    });

    it('should use allow as default when configured', () => {
      const allowEngine = createPolicyEngine({
        defaultEffect: 'allow',
        enableTenantIsolation: false,
      });

      const result = allowEngine.evaluate('update', 'anything', { _id: '1' }, authContext);
      expect(result.allowed).toBe(true);
    });
  });

  describe('tenant isolation', () => {
    it('should deny access to documents from other tenants', () => {
      const tenantEngine = createPolicyEngine({
        policies: [{ ...readPolicy, conditions: [] }],
        defaultEffect: 'deny',
        enableTenantIsolation: true,
        tenantField: '_tenantId',
      });

      const doc = { _id: 'doc-1', _tenantId: 'tenant-other' };
      const result = tenantEngine.evaluate('read', 'todos', doc, authContext);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tenant isolation');
    });

    it('should allow access to documents from the same tenant', () => {
      const tenantEngine = createPolicyEngine({
        policies: [{ ...readPolicy, conditions: [] }],
        defaultEffect: 'deny',
        enableTenantIsolation: true,
        tenantField: '_tenantId',
      });

      const doc = { _id: 'doc-1', _tenantId: 'tenant-1' };
      const result = tenantEngine.evaluate('read', 'todos', doc, authContext);

      expect(result.allowed).toBe(true);
    });
  });

  describe('addPolicy / removePolicy', () => {
    it('should add a policy dynamically', () => {
      const newPolicy: Policy = {
        name: 'insert-allow',
        collection: 'todos',
        actions: ['insert'],
        effect: 'allow',
        conditions: [],
        priority: 5,
      };

      engine.addPolicy(newPolicy);

      const result = engine.evaluate('insert', 'todos', { _id: '1' }, authContext);
      expect(result.allowed).toBe(true);
    });

    it('should remove a policy by name', () => {
      engine.removePolicy('allow-read');

      const policies = engine.getApplicablePolicies('read', 'todos');
      expect(policies).toHaveLength(0);
    });
  });
});
