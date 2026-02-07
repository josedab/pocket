import { describe, it, expect, beforeEach } from 'vitest';
import { createTenantManager, TenantManager } from '../tenant-manager.js';
import type { AuthContext } from '../types.js';

describe('TenantManager', () => {
  let manager: TenantManager;
  let authContext: AuthContext;

  beforeEach(() => {
    manager = createTenantManager({ tenantField: '_tenantId' });

    authContext = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roles: ['member'],
      metadata: {},
    };
  });

  describe('injectTenantId', () => {
    it('should add tenant field to a document', () => {
      const doc = { _id: 'doc-1', title: 'Hello' };
      const result = manager.injectTenantId(doc, 'tenant-1');

      expect(result).toEqual({
        _id: 'doc-1',
        title: 'Hello',
        _tenantId: 'tenant-1',
      });
    });

    it('should overwrite existing tenant field', () => {
      const doc = { _id: 'doc-1', _tenantId: 'old-tenant' };
      const result = manager.injectTenantId(doc, 'new-tenant');

      expect(result._tenantId).toBe('new-tenant');
    });
  });

  describe('buildTenantFilter', () => {
    it('should return a filter object with the tenant field', () => {
      const filter = manager.buildTenantFilter('tenant-1');

      expect(filter).toEqual({ _tenantId: 'tenant-1' });
    });

    it('should use a custom tenant field name', () => {
      const customManager = createTenantManager({ tenantField: 'orgId' });
      const filter = customManager.buildTenantFilter('org-42');

      expect(filter).toEqual({ orgId: 'org-42' });
    });
  });

  describe('validateTenantAccess', () => {
    it('should return true when document belongs to the tenant', () => {
      const doc = { _id: 'doc-1', _tenantId: 'tenant-1' };
      const result = manager.validateTenantAccess(doc, authContext);

      expect(result).toBe(true);
    });

    it('should return false when document belongs to another tenant', () => {
      const doc = { _id: 'doc-1', _tenantId: 'tenant-other' };
      const result = manager.validateTenantAccess(doc, authContext);

      expect(result).toBe(false);
    });

    it('should return false when document has no tenant field', () => {
      const doc = { _id: 'doc-1' };
      const result = manager.validateTenantAccess(doc, authContext);

      expect(result).toBe(false);
    });
  });

  describe('stripTenantField', () => {
    it('should remove the tenant field from the document', () => {
      const doc = { _id: 'doc-1', title: 'Hello', _tenantId: 'tenant-1' };
      const result = manager.stripTenantField(doc);

      expect(result).toEqual({ _id: 'doc-1', title: 'Hello' });
      expect(result).not.toHaveProperty('_tenantId');
    });

    it('should return the document unchanged if tenant field is absent', () => {
      const doc = { _id: 'doc-1', title: 'Hello' };
      const result = manager.stripTenantField(doc);

      expect(result).toEqual({ _id: 'doc-1', title: 'Hello' });
    });
  });
});
