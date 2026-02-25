/**
 * @pocket/rls - Multi-tenancy and row-level security for Pocket
 *
 * @example
 * ```typescript
 * import { createPolicyEngine, createTenantManager } from '@pocket/rls';
 * import type { AuthContext, Policy } from '@pocket/rls';
 *
 * // Define a policy that allows users to read their own documents
 * const policy: Policy = {
 *   name: 'read-own-docs',
 *   collection: 'todos',
 *   actions: ['read'],
 *   effect: 'allow',
 *   conditions: [{ field: 'ownerId', operator: '$eq', value: 'auth.userId' }],
 *   priority: 10,
 * };
 *
 * const engine = createPolicyEngine({ policies: [policy], defaultEffect: 'deny' });
 * const tenantManager = createTenantManager({ tenantField: '_tenantId' });
 *
 * const authContext: AuthContext = {
 *   userId: 'user-1',
 *   tenantId: 'tenant-1',
 *   roles: ['member'],
 *   metadata: {},
 * };
 *
 * // Inject tenant ID on write
 * const doc = tenantManager.injectTenantId({ _id: 'todo-1', title: 'Buy milk' }, authContext.tenantId);
 *
 * // Build query filters for reads
 * const filter = engine.buildQueryFilter('read', 'todos', authContext);
 * ```
 */

// Types
export { DEFAULT_RLS_CONFIG } from './types.js';
export type {
  AuthContext,
  Policy,
  PolicyAction,
  PolicyCondition,
  PolicyEffect,
  PolicyEvaluationResult,
  PolicyOperator,
  RLSConfig,
  TenantManagerConfig,
} from './types.js';

// Policy Engine
export { PolicyEngine, createPolicyEngine } from './policy-engine.js';

// Tenant Manager
export { TenantManager, createTenantManager } from './tenant-manager.js';

// Declarative RLS
export {
  DeclarativeRLS,
  PolicyBuilder,
  createDeclarativeRLS,
  policy,
  type DeclarativePolicy,
  type DeclarativeRLSStats,
  type PolicyAuditEntry,
  type PolicyBuilderConfig,
} from './declarative-rls.js';

// RLS Storage Middleware
export {
  RLSMiddleware,
  createRLSMiddleware,
  type RLSDeniedError,
  type RLSMiddlewareConfig,
  type WrappableStore,
} from './rls-middleware.js';
