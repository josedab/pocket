/** Actions that can be performed on a document */
export type PolicyAction = 'read' | 'insert' | 'update' | 'delete';

/** Whether a policy allows or denies access */
export type PolicyEffect = 'allow' | 'deny';

/** Comparison operators for policy conditions */
export type PolicyOperator = '$eq' | '$ne' | '$in' | '$nin' | '$exists';

/** Authentication context for the current user */
export interface AuthContext {
  userId: string;
  tenantId: string;
  roles: string[];
  metadata: Record<string, unknown>;
}

/** A single condition that must be met for a policy to apply */
export interface PolicyCondition {
  field: string;
  operator: PolicyOperator;
  value: unknown;
}

/** A security policy that controls access to documents */
export interface Policy {
  name: string;
  collection: string;
  actions: PolicyAction[];
  effect: PolicyEffect;
  conditions: PolicyCondition[];
  priority: number;
}

/** Configuration for the RLS system */
export interface RLSConfig {
  policies: Policy[];
  defaultEffect: PolicyEffect;
  enableTenantIsolation: boolean;
  tenantField: string;
}

/** Result of evaluating a policy against a request */
export interface PolicyEvaluationResult {
  allowed: boolean;
  matchedPolicy?: Policy;
  reason?: string;
}

/** Configuration for the tenant manager */
export interface TenantManagerConfig {
  tenantField: string;
  autoInject: boolean;
}

/** Default RLS configuration */
export const DEFAULT_RLS_CONFIG: RLSConfig = {
  policies: [],
  defaultEffect: 'deny',
  enableTenantIsolation: true,
  tenantField: '_tenantId',
};
