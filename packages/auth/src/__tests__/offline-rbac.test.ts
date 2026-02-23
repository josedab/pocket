import { beforeEach, describe, expect, it } from 'vitest';
import { OfflineRBAC } from '../offline-rbac.js';
import type { AuthUser } from '../types.js';

describe('OfflineRBAC', () => {
  let rbac: OfflineRBAC;

  const policies = {
    'todos:read': ['user', 'editor', 'admin'],
    'todos:write': ['editor', 'admin'],
    'todos:delete': ['admin'],
    'users:read': ['admin'],
    'users:*': ['admin'],
    'reports:view': ['analyst', 'admin'],
  };

  const regularUser: AuthUser = {
    id: '1',
    name: 'Alice',
    roles: ['user'],
    email: 'alice@test.com',
  };
  const editorUser: AuthUser = { id: '2', name: 'Bob', roles: ['user', 'editor'] };
  const adminUser: AuthUser = { id: '3', name: 'Charlie', roles: ['admin'] };
  const analystUser: AuthUser = { id: '4', name: 'Diana', roles: ['analyst'] };

  beforeEach(() => {
    rbac = new OfflineRBAC({ policies });
  });

  describe('can', () => {
    it('should grant permission when user role matches', () => {
      rbac.setUser(regularUser);
      expect(rbac.can('todos:read')).toBe(true);
    });

    it('should deny permission when user role does not match', () => {
      rbac.setUser(regularUser);
      expect(rbac.can('todos:write')).toBe(false);
      expect(rbac.can('todos:delete')).toBe(false);
    });

    it('should deny all permissions when no user is set', () => {
      expect(rbac.can('todos:read')).toBe(false);
    });

    it('should grant super-admin all permissions', () => {
      rbac.setUser(adminUser);
      expect(rbac.can('todos:read')).toBe(true);
      expect(rbac.can('todos:write')).toBe(true);
      expect(rbac.can('todos:delete')).toBe(true);
      expect(rbac.can('users:read')).toBe(true);
      expect(rbac.can('unknown:permission')).toBe(true);
    });

    it('should handle editor with multiple permissions', () => {
      rbac.setUser(editorUser);
      expect(rbac.can('todos:read')).toBe(true);
      expect(rbac.can('todos:write')).toBe(true);
      expect(rbac.can('todos:delete')).toBe(false);
    });
  });

  describe('canAll / canAny', () => {
    it('should check all permissions with canAll', () => {
      rbac.setUser(editorUser);
      expect(rbac.canAll(['todos:read', 'todos:write'])).toBe(true);
      expect(rbac.canAll(['todos:read', 'todos:delete'])).toBe(false);
    });

    it('should check any permission with canAny', () => {
      rbac.setUser(regularUser);
      expect(rbac.canAny(['todos:read', 'todos:write'])).toBe(true);
      expect(rbac.canAny(['todos:delete', 'users:read'])).toBe(false);
    });
  });

  describe('evaluate', () => {
    it('should provide detailed evaluation', () => {
      rbac.setUser(regularUser);
      const result = rbac.evaluate('todos:write');
      expect(result.granted).toBe(false);
      expect(result.reason).toContain("don't match");
      expect(result.evaluatedAt).toBeGreaterThan(0);
    });

    it('should cache evaluations', () => {
      rbac.setUser(regularUser);
      const first = rbac.evaluate('todos:read');
      const second = rbac.evaluate('todos:read');
      expect(second.reason).toBe('cached');
      expect(first.granted).toBe(second.granted);
    });
  });

  describe('wildcard policies', () => {
    it('should match wildcard policies', () => {
      rbac.setUser(adminUser);
      // admin has super role, bypasses anyway
      expect(rbac.can('users:write')).toBe(true);
    });

    it('should match wildcard for non-super role', () => {
      const customRbac = new OfflineRBAC({
        policies: { 'docs:*': ['editor'] },
        superAdminRole: 'superadmin', // not 'admin'
      });
      customRbac.setUser({ id: '1', roles: ['editor'] });
      expect(customRbac.can('docs:read')).toBe(true);
      expect(customRbac.can('docs:write')).toBe(true);
    });
  });

  describe('hasRole', () => {
    it('should check if user has a specific role', () => {
      rbac.setUser(editorUser);
      expect(rbac.hasRole('editor')).toBe(true);
      expect(rbac.hasRole('admin')).toBe(false);
    });
  });

  describe('getGrantedPermissions', () => {
    it('should list all granted permissions', () => {
      rbac.setUser(analystUser);
      const granted = rbac.getGrantedPermissions();
      expect(granted).toContain('reports:view');
      expect(granted).not.toContain('todos:write');
    });

    it('should return empty for no user', () => {
      expect(rbac.getGrantedPermissions()).toEqual([]);
    });
  });

  describe('updatePolicies', () => {
    it('should update policies at runtime', () => {
      rbac.setUser(regularUser);
      expect(rbac.can('billing:view')).toBe(false);

      rbac.updatePolicies({ 'billing:view': ['user'] });
      expect(rbac.can('billing:view')).toBe(true);
    });
  });

  describe('addPolicy', () => {
    it('should add a single policy', () => {
      rbac.setUser(analystUser);
      expect(rbac.can('dashboard:view')).toBe(false);

      rbac.addPolicy('dashboard:view', ['analyst']);
      expect(rbac.can('dashboard:view')).toBe(true);
    });
  });

  describe('state$', () => {
    it('should emit state changes', () => {
      const states: unknown[] = [];
      rbac.state$.subscribe((s) => states.push(s));

      rbac.setUser(regularUser);
      expect(states.length).toBeGreaterThanOrEqual(2); // initial + setUser
    });
  });

  describe('denyByDefault option', () => {
    it('should allow unknown permissions when denyByDefault is false', () => {
      const permissive = new OfflineRBAC({
        policies: {},
        denyByDefault: false,
        superAdminRole: 'superadmin',
      });
      permissive.setUser({ id: '1', roles: ['user'] });
      expect(permissive.can('anything')).toBe(true);
    });
  });
});
