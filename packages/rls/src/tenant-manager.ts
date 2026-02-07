import type { Document } from '@pocket/core';
import type { AuthContext, TenantManagerConfig } from './types.js';

const DEFAULT_TENANT_CONFIG: TenantManagerConfig = {
  tenantField: '_tenantId',
  autoInject: true,
};

/**
 * Manages tenant isolation by injecting tenant identifiers into documents
 * and building filters for multi-tenant queries.
 */
export class TenantManager {
  private readonly config: TenantManagerConfig;

  constructor(config: Partial<TenantManagerConfig> = {}) {
    this.config = { ...DEFAULT_TENANT_CONFIG, ...config };
  }

  /** Inject the tenant ID into a document for write operations */
  injectTenantId<T extends Record<string, unknown>>(
    document: T,
    tenantId: string,
  ): T & Record<string, unknown> {
    return {
      ...document,
      [this.config.tenantField]: tenantId,
    };
  }

  /** Build a query filter that restricts results to a specific tenant */
  buildTenantFilter(tenantId: string): Record<string, unknown> {
    return {
      [this.config.tenantField]: tenantId,
    };
  }

  /** Validate that a document belongs to the authenticated tenant */
  validateTenantAccess(
    document: Document & Record<string, unknown>,
    authContext: AuthContext,
  ): boolean {
    const tenantValue = document[this.config.tenantField];
    return tenantValue === authContext.tenantId;
  }

  /** Remove the internal tenant field from a document before returning to clients */
  stripTenantField<T extends Record<string, unknown>>(document: T): Omit<T, string> {
    const { [this.config.tenantField]: _, ...rest } = document;
    return rest;
  }
}

/** Create a new TenantManager instance */
export function createTenantManager(
  config: Partial<TenantManagerConfig> = {},
): TenantManager {
  return new TenantManager(config);
}
