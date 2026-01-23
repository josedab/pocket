/**
 * Types for Permissions & Row-Level Security
 */

/**
 * Permission actions
 */
export type PermissionAction = 'create' | 'read' | 'update' | 'delete' | 'list' | 'admin';

/**
 * Resource type for permissions
 */
export interface Resource {
  /** Resource type (collection name) */
  type: string;
  /** Optional resource ID for specific resource */
  id?: string;
  /** Additional resource attributes */
  attributes?: Record<string, unknown>;
}

/**
 * User context for permission evaluation
 */
export interface UserContext {
  /** User ID */
  id: string;
  /** User roles */
  roles: string[];
  /** User attributes */
  attributes: Record<string, unknown>;
  /** User groups */
  groups?: string[];
  /** Organization ID */
  organizationId?: string;
  /** Team IDs */
  teamIds?: string[];
  /** Custom claims */
  claims?: Record<string, unknown>;
}

/**
 * Permission rule condition
 */
export interface PermissionCondition {
  /** Field to check */
  field: string;
  /** Operator */
  operator: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists';
  /** Value to compare (can reference user context with $ prefix) */
  value: unknown;
}

/**
 * Permission rule definition
 */
export interface PermissionRule {
  /** Rule ID */
  id: string;
  /** Rule name */
  name: string;
  /** Rule description */
  description?: string;
  /** Resource type this rule applies to */
  resource: string;
  /** Actions this rule applies to */
  actions: PermissionAction[];
  /** Roles that can use this rule (empty = all) */
  roles?: string[];
  /** Conditions that must be met (AND) */
  conditions?: PermissionCondition[];
  /** Effect of the rule */
  effect: 'allow' | 'deny';
  /** Rule priority (higher = evaluated first) */
  priority?: number;
  /** Whether rule is enabled */
  enabled?: boolean;
}

/**
 * Row-level security policy
 */
export interface RLSPolicy {
  /** Policy ID */
  id: string;
  /** Policy name */
  name: string;
  /** Collection this policy applies to */
  collection: string;
  /** Policy description */
  description?: string;
  /** Filter expression (references user context with $user) */
  filter: RLSFilter;
  /** Actions this policy applies to */
  actions: PermissionAction[];
  /** Whether policy is enabled */
  enabled?: boolean;
}

/**
 * RLS filter definition
 */
export interface RLSFilter {
  /** Filter type */
  type: 'field' | 'expression' | 'function';
  /** For field type: field to match */
  field?: string;
  /** For field type: user context path to match against */
  userPath?: string;
  /** For expression type: boolean expression */
  expression?: string;
  /** For function type: function name */
  function?: string;
  /** Combined filters with AND */
  and?: RLSFilter[];
  /** Combined filters with OR */
  or?: RLSFilter[];
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** Matched rule (if any) */
  matchedRule?: PermissionRule;
  /** Matched policy (if any) */
  matchedPolicy?: RLSPolicy;
  /** Evaluation details */
  details?: {
    evaluatedRules: number;
    evaluatedPolicies: number;
    evaluationTime: number;
  };
}

/**
 * Field-level permission
 */
export interface FieldPermission {
  /** Field path */
  field: string;
  /** Allowed actions */
  actions: ('read' | 'write')[];
  /** Roles that can access */
  roles?: string[];
  /** Conditions for access */
  conditions?: PermissionCondition[];
}

/**
 * Collection-level permission configuration
 */
export interface CollectionPermissions {
  /** Collection name */
  collection: string;
  /** Default policy (allow or deny) */
  defaultPolicy: 'allow' | 'deny';
  /** Permission rules */
  rules: PermissionRule[];
  /** RLS policies */
  rlsPolicies: RLSPolicy[];
  /** Field-level permissions */
  fieldPermissions?: FieldPermission[];
}

/**
 * Permission configuration
 */
export interface PermissionConfig {
  /** Default policy when no rules match */
  defaultPolicy: 'allow' | 'deny';
  /** Global permission rules */
  globalRules: PermissionRule[];
  /** Collection-specific permissions */
  collections: Record<string, CollectionPermissions>;
  /** Enable audit logging */
  auditEnabled?: boolean;
  /** Cache permission checks */
  cacheEnabled?: boolean;
  /** Cache TTL in ms */
  cacheTTL?: number;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** Entry ID */
  id: string;
  /** Timestamp */
  timestamp: number;
  /** User who performed action */
  userId: string;
  /** Action performed */
  action: PermissionAction;
  /** Resource type */
  resourceType: string;
  /** Resource ID */
  resourceId?: string;
  /** Whether access was allowed */
  allowed: boolean;
  /** Reason for decision */
  reason: string;
  /** Matched rule ID */
  matchedRuleId?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Permission event types
 */
export type PermissionEventType =
  | 'check'
  | 'allow'
  | 'deny'
  | 'rule-added'
  | 'rule-removed'
  | 'policy-added'
  | 'policy-removed'
  | 'cache-hit'
  | 'cache-miss';

/**
 * Permission event
 */
export interface PermissionEvent {
  /** Event type */
  type: PermissionEventType;
  /** User ID */
  userId?: string;
  /** Resource */
  resource?: Resource;
  /** Action */
  action?: PermissionAction;
  /** Result */
  result?: PermissionCheckResult;
  /** Timestamp */
  timestamp: number;
}
