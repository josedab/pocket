import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionManager, createPermissionManager } from '../permission-manager.js';
import type { Resource, UserContext } from '../types.js';

function makeUser(overrides: Partial<UserContext> = {}): UserContext {
  return {
    id: 'user-1',
    roles: ['viewer'],
    attributes: {},
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    type: 'documents',
    ...overrides,
  };
}

describe('PermissionManager', () => {
  let manager: PermissionManager;

  beforeEach(() => {
    manager = new PermissionManager({ defaultPolicy: 'deny' });
  });

  describe('addRule / removeRule', () => {
    it('should add a global rule and return it with generated id', () => {
      const rule = manager.addRule({
        name: 'allow-read',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      expect(rule.id).toBeDefined();
      expect(rule.name).toBe('allow-read');
      expect(rule.enabled).toBe(true);
      expect(manager.getRules()).toHaveLength(1);
    });

    it('should remove a global rule', () => {
      const rule = manager.addRule({
        name: 'allow-read',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      const removed = manager.removeRule(rule.id);
      expect(removed).toBe(true);
      expect(manager.getRules()).toHaveLength(0);
    });

    it('should return false when removing non-existent rule', () => {
      expect(manager.removeRule('nonexistent')).toBe(false);
    });
  });

  describe('check / can', () => {
    it('should check permission and return result', () => {
      manager.addRule({
        name: 'allow-read',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      const result = manager.check(makeUser(), 'read', makeResource());
      expect(result.allowed).toBe(true);
    });

    it('can() should return boolean shorthand', () => {
      manager.addRule({
        name: 'allow-read',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      expect(manager.can(makeUser(), 'read', makeResource())).toBe(true);
      expect(manager.can(makeUser(), 'delete', makeResource())).toBe(false);
    });
  });

  describe('filter()', () => {
    it('should filter documents using RLS policy', () => {
      manager.addRLSPolicy('documents', {
        name: 'owner-only',
        collection: 'documents',
        actions: ['read'],
        filter: { type: 'field', field: 'ownerId', userPath: 'id' },
      });

      const docs = [
        { _id: '1', ownerId: 'user-1' },
        { _id: '2', ownerId: 'user-2' },
        { _id: '3', ownerId: 'user-1' },
      ];

      const filtered = manager.filter(makeUser({ id: 'user-1' }), 'documents', docs);
      expect(filtered).toHaveLength(2);
    });
  });

  describe('addCollectionRule / addRLSPolicy', () => {
    it('should add collection-specific rule', () => {
      const rule = manager.addCollectionRule('documents', {
        name: 'doc-read',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      expect(rule.id).toBeDefined();
      expect(manager.can(makeUser(), 'read', makeResource())).toBe(true);
    });

    it('should add and remove RLS policy', () => {
      const policy = manager.addRLSPolicy('documents', {
        name: 'test-policy',
        collection: 'documents',
        actions: ['read'],
        filter: { type: 'field', field: 'ownerId', userPath: 'id' },
      });

      expect(policy.id).toBeDefined();
      expect(manager.getRLSPolicies()).toHaveLength(1);

      const removed = manager.removeRLSPolicy('documents', policy.id);
      expect(removed).toBe(true);
      expect(manager.getRLSPolicies()).toHaveLength(0);
    });

    it('should return false when removing non-existent policy', () => {
      expect(manager.removeRLSPolicy('documents', 'nonexistent')).toBe(false);
      expect(manager.removeRLSPolicy('nonexistent', 'x')).toBe(false);
    });
  });

  describe('setRuleEnabled / setPolicyEnabled', () => {
    it('should enable/disable a global rule', () => {
      const rule = manager.addRule({
        name: 'test',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      manager.setRuleEnabled(rule.id, false);
      expect(manager.can(makeUser(), 'read', makeResource())).toBe(false);

      manager.setRuleEnabled(rule.id, true);
      expect(manager.can(makeUser(), 'read', makeResource())).toBe(true);
    });

    it('should return false for non-existent rule', () => {
      expect(manager.setRuleEnabled('nonexistent', true)).toBe(false);
    });

    it('should enable/disable RLS policy', () => {
      const policy = manager.addRLSPolicy('documents', {
        name: 'test',
        collection: 'documents',
        actions: ['read'],
        filter: { type: 'field', field: 'ownerId', userPath: 'id' },
      });

      const result = manager.setPolicyEnabled('documents', policy.id, false);
      expect(result).toBe(true);
    });

    it('should return false for non-existent policy', () => {
      expect(manager.setPolicyEnabled('documents', 'nonexistent', true)).toBe(false);
      expect(manager.setPolicyEnabled('nonexistent', 'x', true)).toBe(false);
    });
  });

  describe('setDefaultPolicy', () => {
    it('should change default policy', () => {
      expect(manager.can(makeUser(), 'read', makeResource())).toBe(false);

      manager.setDefaultPolicy('allow');
      expect(manager.can(makeUser(), 'read', makeResource())).toBe(true);
    });
  });

  describe('collection permissions', () => {
    it('should set and get collection permissions', () => {
      manager.setCollectionPermissions('documents', {
        defaultPolicy: 'allow',
        rules: [],
        rlsPolicies: [],
      });

      const perms = manager.getCollectionPermissions('documents');
      expect(perms).toBeDefined();
      expect(perms!.defaultPolicy).toBe('allow');
    });

    it('should return undefined for non-existent collection', () => {
      expect(manager.getCollectionPermissions('nonexistent')).toBeUndefined();
    });
  });

  describe('config import/export', () => {
    it('should export config as JSON', () => {
      manager.addRule({
        name: 'test',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      const json = manager.exportConfig();
      const parsed = JSON.parse(json);
      expect(parsed.globalRules).toHaveLength(1);
      expect(parsed.defaultPolicy).toBe('deny');
    });

    it('should import config from JSON', () => {
      const config = {
        defaultPolicy: 'allow' as const,
        globalRules: [],
        collections: {},
      };
      manager.importConfig(JSON.stringify(config));

      expect(manager.can(makeUser(), 'read', makeResource())).toBe(true);
    });
  });

  describe('events and audit', () => {
    it('should emit events on check', () => {
      const events: unknown[] = [];
      manager.events.subscribe((e) => events.push(e));

      manager.can(makeUser(), 'read', makeResource());

      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('should emit audit logs when enabled', () => {
      const auditManager = new PermissionManager({
        defaultPolicy: 'deny',
        auditEnabled: true,
      });
      const logs: unknown[] = [];
      auditManager.auditLog.subscribe((l) => logs.push(l));

      auditManager.can(makeUser(), 'read', makeResource());

      expect(logs).toHaveLength(1);
    });

    it('should emit rule-added event', () => {
      const events: unknown[] = [];
      manager.events.subscribe((e) => events.push(e));

      manager.addRule({
        name: 'test',
        resource: 'documents',
        actions: ['read'],
        effect: 'allow',
      });

      expect(events.some((e: any) => e.type === 'rule-added')).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('should clear the evaluator cache', () => {
      manager.can(makeUser(), 'read', makeResource({ id: 'doc-1' }));
      manager.clearCache();
      // Should still work
      const result = manager.can(makeUser(), 'read', makeResource({ id: 'doc-1' }));
      expect(typeof result).toBe('boolean');
    });
  });

  describe('destroy', () => {
    it('should complete all subjects', () => {
      let completed = false;
      manager.events.subscribe({
        complete: () => {
          completed = true;
        },
      });
      manager.destroy();
      expect(completed).toBe(true);
    });
  });

  describe('factory function', () => {
    it('should create manager via createPermissionManager', () => {
      const m = createPermissionManager({ defaultPolicy: 'allow' });
      expect(m).toBeInstanceOf(PermissionManager);
      expect(m.can(makeUser(), 'read', makeResource())).toBe(true);
    });
  });
});
