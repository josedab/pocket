import { describe, expect, it } from 'vitest';
import { DeclarativeRLS, policy } from '../declarative-rls.js';
import type { AuthContext } from '../types.js';

const adminCtx: AuthContext = { userId: 'admin-1', tenantId: 't1', roles: ['admin'], metadata: {} };
const userCtx: AuthContext = { userId: 'user-1', tenantId: 't1', roles: ['user'], metadata: {} };
const otherTenantCtx: AuthContext = {
  userId: 'user-2',
  tenantId: 't2',
  roles: ['user'],
  metadata: {},
};

describe('DeclarativeRLS', () => {
  describe('PolicyBuilder', () => {
    it('should build a policy with fluent DSL', () => {
      const p = policy()
        .name('user-read')
        .collection('orders')
        .actions('read')
        .allow()
        .requireRole('user', 'admin')
        .build();

      expect(p.name).toBe('user-read');
      expect(p.collection).toBe('orders');
      expect(p.actions).toEqual(['read']);
      expect(p.effect).toBe('allow');
    });

    it('should enforce tenant isolation', () => {
      const p = policy()
        .name('tenant-iso')
        .collection('orders')
        .actions('read', 'update')
        .allow()
        .tenantIsolation('_tenantId')
        .build();

      expect(p.evaluate(userCtx, { _id: '1', _tenantId: 't1' })).toBe(true);
      expect(p.evaluate(otherTenantCtx, { _id: '1', _tenantId: 't1' })).toBe(false);
    });

    it('should support where conditions', () => {
      const p = policy()
        .name('own-docs')
        .collection('docs')
        .actions('update', 'delete')
        .allow()
        .where('ownerId', 'eq', 'ctx.userId')
        .build();

      expect(p.evaluate(userCtx, { _id: '1', ownerId: 'user-1' })).toBe(true);
      expect(p.evaluate(userCtx, { _id: '2', ownerId: 'other' })).toBe(false);
    });

    it('should require name and collection', () => {
      expect(() => policy().actions('read').build()).toThrow('name is required');
      expect(() => policy().name('x').actions('read').build()).toThrow('collection is required');
    });
  });

  describe('DeclarativeRLS engine', () => {
    it('should deny by default when no policies match', () => {
      const rls = new DeclarativeRLS();
      const result = rls.evaluate('read', 'orders', { _id: '1' }, userCtx);
      expect(result.allowed).toBe(false);
    });

    it('should allow when policy matches', () => {
      const rls = new DeclarativeRLS();
      rls.addPolicy(
        policy()
          .name('all-read')
          .collection('orders')
          .actions('read')
          .allow()
          .requireRole('user')
          .build()
      );

      expect(rls.evaluate('read', 'orders', { _id: '1' }, userCtx).allowed).toBe(true);
      expect(rls.evaluate('delete', 'orders', { _id: '1' }, userCtx).allowed).toBe(false);
    });

    it('should respect policy priority', () => {
      const rls = new DeclarativeRLS();

      rls.addPolicy(
        policy()
          .name('deny-all')
          .collection('secrets')
          .actions('read')
          .deny()
          .priority(1)
          .requireRole('user')
          .build()
      );
      rls.addPolicy(
        policy()
          .name('admin-override')
          .collection('secrets')
          .actions('read')
          .allow()
          .priority(10)
          .requireRole('admin')
          .build()
      );

      expect(rls.evaluate('read', 'secrets', { _id: '1' }, adminCtx).allowed).toBe(true);
      expect(rls.evaluate('read', 'secrets', { _id: '1' }, userCtx).allowed).toBe(false);
    });

    it('should filter documents with filterAllowed', () => {
      const rls = new DeclarativeRLS();
      rls.addPolicy(
        policy()
          .name('tenant')
          .collection('orders')
          .actions('read')
          .allow()
          .tenantIsolation('tenantId')
          .build()
      );

      const docs = [
        { _id: '1', tenantId: 't1', amount: 100 },
        { _id: '2', tenantId: 't2', amount: 200 },
        { _id: '3', tenantId: 't1', amount: 300 },
      ];

      const allowed = rls.filterAllowed('read', 'orders', docs, userCtx);
      expect(allowed).toHaveLength(2);
      expect(allowed.every((d) => d.tenantId === 't1')).toBe(true);
    });

    it('should track statistics', () => {
      const rls = new DeclarativeRLS();
      rls.addPolicy(
        policy()
          .name('test')
          .collection('items')
          .actions('read')
          .allow()
          .requireRole('user')
          .build()
      );

      rls.evaluate('read', 'items', { _id: '1' }, userCtx);
      rls.evaluate('read', 'items', { _id: '2' }, userCtx);
      rls.evaluate('write' as 'update', 'items', { _id: '3' }, userCtx);

      const stats = rls.getStats();
      expect(stats.totalEvaluations).toBe(3);
      expect(stats.allowedCount).toBe(2);
      expect(stats.policyCount).toBe(1);
    });

    it('should support audit logging', () => {
      const rls = new DeclarativeRLS({ enableAuditLog: true });
      rls.addPolicy(
        policy()
          .name('test')
          .collection('items')
          .actions('read')
          .allow()
          .requireRole('user')
          .build()
      );

      rls.evaluate('read', 'items', { _id: '1' }, userCtx);
      const log = rls.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0]!.allowed).toBe(true);
      expect(log[0]!.userId).toBe('user-1');
    });

    it('should sync policies from remote', () => {
      const rls = new DeclarativeRLS();
      rls.addPolicy(
        policy().name('old').collection('c').actions('read').allow().requireRole('user').build()
      );

      rls.syncPolicies([
        policy()
          .name('new')
          .collection('c')
          .actions('read', 'update')
          .allow()
          .requireRole('admin')
          .build(),
      ]);

      expect(rls.listPolicies()).toHaveLength(1);
      expect(rls.listPolicies()[0]!.name).toBe('new');
    });
  });
});
