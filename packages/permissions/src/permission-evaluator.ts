/**
 * Permission Evaluator - Evaluates permission rules and RLS policies
 */

import type {
  PermissionAction,
  PermissionCheckResult,
  PermissionCondition,
  PermissionConfig,
  PermissionRule,
  Resource,
  RLSFilter,
  RLSPolicy,
  UserContext,
} from './types.js';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: PermissionConfig = {
  defaultPolicy: 'deny',
  globalRules: [],
  collections: {},
  auditEnabled: false,
  cacheEnabled: true,
  cacheTTL: 60000,
  debug: false,
};

/**
 * Get a value from a nested object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let value: unknown = obj;

  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

/**
 * Resolve a value that may reference user context
 */
function resolveValue(value: unknown, userContext: UserContext): unknown {
  if (typeof value !== 'string') return value;

  // Check for user context reference ($user.field)
  if (value.startsWith('$user.')) {
    const path = value.substring(6);
    return getNestedValue(userContext as unknown as Record<string, unknown>, path);
  }

  // Check for simple $userId reference
  if (value === '$userId') {
    return userContext.id;
  }

  return value;
}

/**
 * Evaluate a single condition
 */
function evaluateCondition(
  condition: PermissionCondition,
  resource: Resource,
  userContext: UserContext
): boolean {
  const fieldValue = resource.attributes
    ? getNestedValue(resource.attributes, condition.field)
    : undefined;
  const compareValue = resolveValue(condition.value, userContext);

  switch (condition.operator) {
    case 'eq':
      return fieldValue === compareValue;

    case 'neq':
      return fieldValue !== compareValue;

    case 'in':
      if (!Array.isArray(compareValue)) return false;
      return compareValue.includes(fieldValue);

    case 'nin':
      if (!Array.isArray(compareValue)) return false;
      return !compareValue.includes(fieldValue);

    case 'gt':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) > String(compareValue);
      }
      return fieldValue > compareValue;

    case 'gte':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) >= String(compareValue);
      }
      return fieldValue >= compareValue;

    case 'lt':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) < String(compareValue);
      }
      return fieldValue < compareValue;

    case 'lte':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) <= String(compareValue);
      }
      return fieldValue <= compareValue;

    case 'contains':
      if (typeof fieldValue !== 'string' || typeof compareValue !== 'string') {
        return false;
      }
      return fieldValue.includes(compareValue);

    case 'exists': {
      const exists = fieldValue !== undefined && fieldValue !== null;
      return compareValue ? exists : !exists;
    }

    default:
      return false;
  }
}

/**
 * Safely resolve a $doc.path or $user.path reference to its value.
 * Returns undefined for unrecognized prefixes.
 */
function resolveExpressionOperand(
  token: string,
  doc: Record<string, unknown>,
  user: UserContext
): unknown {
  const trimmed = token.trim();

  if (trimmed.startsWith('$doc.')) {
    return getNestedValue(doc, trimmed.substring(5));
  }
  if (trimmed.startsWith('$user.')) {
    return getNestedValue(user as unknown as Record<string, unknown>, trimmed.substring(6));
  }

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Boolean literal
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;

  // Quoted string literal
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  return undefined;
}

const SAFE_OPERATORS = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'] as const;

/**
 * Evaluate a simple expression string without using eval or new Function.
 * Supports: `$doc.field === $user.field`, `$doc.field > 42`, etc.
 * Only property access via dot notation and basic comparison operators are allowed.
 */
function evaluateSafeExpression(
  expression: string,
  doc: Record<string, unknown>,
  user: UserContext
): boolean {
  // Reject expressions that contain suspicious patterns
  if (/[;{}()[\]\\]/.test(expression)) {
    return false;
  }

  // Find the comparison operator
  let matchedOp: (typeof SAFE_OPERATORS)[number] | undefined;
  let opIndex = -1;

  for (const op of SAFE_OPERATORS) {
    const idx = expression.indexOf(op);
    if (idx !== -1 && (opIndex === -1 || idx < opIndex || op.length > (matchedOp?.length ?? 0))) {
      // Pick the longest operator at the earliest position
      if (opIndex === -1 || idx < opIndex) {
        matchedOp = op;
        opIndex = idx;
      } else if (idx === opIndex && op.length > (matchedOp?.length ?? 0)) {
        matchedOp = op;
      }
    }
  }

  if (!matchedOp || opIndex === -1) {
    return false;
  }

  const left = resolveExpressionOperand(expression.substring(0, opIndex), doc, user);
  const right = resolveExpressionOperand(expression.substring(opIndex + matchedOp.length), doc, user);

  switch (matchedOp) {
    case '===':
    case '==':
      return left === right;
    case '!==':
    case '!=':
      return left !== right;
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    default:
      return false;
  }
}

/**
 * Evaluate RLS filter
 */
function evaluateRLSFilter(
  filter: RLSFilter,
  document: Record<string, unknown>,
  userContext: UserContext
): boolean {
  // Handle AND combination
  if (filter.and && filter.and.length > 0) {
    return filter.and.every((f) => evaluateRLSFilter(f, document, userContext));
  }

  // Handle OR combination
  if (filter.or && filter.or.length > 0) {
    return filter.or.some((f) => evaluateRLSFilter(f, document, userContext));
  }

  switch (filter.type) {
    case 'field': {
      if (!filter.field || !filter.userPath) return false;

      const docValue = getNestedValue(document, filter.field);
      const userValue = getNestedValue(
        userContext as unknown as Record<string, unknown>,
        filter.userPath
      );

      // Handle array membership
      if (Array.isArray(docValue)) {
        return docValue.includes(userValue);
      }
      if (Array.isArray(userValue)) {
        return userValue.includes(docValue);
      }

      return docValue === userValue;
    }

    case 'expression': {
      if (!filter.expression) return false;

      try {
        return evaluateSafeExpression(filter.expression, document, userContext);
      } catch {
        return false;
      }
    }

    case 'function': {
      // Function-based filters would be implemented here
      // For now, return true as placeholder
      return true;
    }

    default:
      return false;
  }
}

/**
 * Evaluates permission rules and RLS policies
 */
export class PermissionEvaluator {
  private readonly config: PermissionConfig;
  private readonly cache = new Map<string, { result: PermissionCheckResult; expiresAt: number }>();

  constructor(config: Partial<PermissionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if an action is allowed on a resource
   */
  checkPermission(
    userContext: UserContext,
    action: PermissionAction,
    resource: Resource
  ): PermissionCheckResult {
    const startTime = Date.now();

    // Check cache
    if (this.config.cacheEnabled) {
      const cacheKey = this.getCacheKey(userContext, action, resource);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.result;
      }
    }

    let evaluatedRules = 0;
    let evaluatedPolicies = 0;

    // Get applicable rules
    const rules = this.getApplicableRules(resource.type);
    const sortedRules = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    // Evaluate rules
    for (const rule of sortedRules) {
      if (!rule.enabled) continue;
      evaluatedRules++;

      // Check if action matches
      if (!rule.actions.includes(action)) continue;

      // Check if role matches
      if (rule.roles && rule.roles.length > 0) {
        const hasRole = rule.roles.some((r) => userContext.roles.includes(r));
        if (!hasRole) continue;
      }

      // Check conditions
      if (rule.conditions && rule.conditions.length > 0) {
        const conditionsMet = rule.conditions.every((c) =>
          evaluateCondition(c, resource, userContext)
        );
        if (!conditionsMet) continue;
      }

      // Rule matches!
      const result: PermissionCheckResult = {
        allowed: rule.effect === 'allow',
        reason: `Rule "${rule.name}" ${rule.effect === 'allow' ? 'allows' : 'denies'} access`,
        matchedRule: rule,
        details: {
          evaluatedRules,
          evaluatedPolicies,
          evaluationTime: Date.now() - startTime,
        },
      };

      this.cacheResult(userContext, action, resource, result);
      return result;
    }

    // Check RLS policies for read/list actions
    if (action === 'read' || action === 'list') {
      const policies = this.getApplicableRLSPolicies(resource.type, action);

      for (const policy of policies) {
        if (!policy.enabled) continue;
        evaluatedPolicies++;

        if (resource.attributes) {
          const matches = evaluateRLSFilter(policy.filter, resource.attributes, userContext);

          if (matches) {
            const result: PermissionCheckResult = {
              allowed: true,
              reason: `RLS policy "${policy.name}" allows access`,
              matchedPolicy: policy,
              details: {
                evaluatedRules,
                evaluatedPolicies,
                evaluationTime: Date.now() - startTime,
              },
            };

            this.cacheResult(userContext, action, resource, result);
            return result;
          }
        }
      }
    }

    // No rule matched, use default policy
    const result: PermissionCheckResult = {
      allowed: this.config.defaultPolicy === 'allow',
      reason: `Default policy: ${this.config.defaultPolicy}`,
      details: {
        evaluatedRules,
        evaluatedPolicies,
        evaluationTime: Date.now() - startTime,
      },
    };

    this.cacheResult(userContext, action, resource, result);
    return result;
  }

  /**
   * Filter documents based on RLS policies
   */
  filterDocuments<T extends Record<string, unknown>>(
    userContext: UserContext,
    collection: string,
    documents: T[],
    action: PermissionAction = 'read'
  ): T[] {
    const policies = this.getApplicableRLSPolicies(collection, action);

    if (policies.length === 0) {
      // No policies, check default
      return this.config.defaultPolicy === 'allow' ? documents : [];
    }

    return documents.filter((doc) => {
      // Check all applicable policies
      for (const policy of policies) {
        if (!policy.enabled) continue;

        if (evaluateRLSFilter(policy.filter, doc, userContext)) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Get applicable rules for a resource type
   */
  private getApplicableRules(resourceType: string): PermissionRule[] {
    const rules: PermissionRule[] = [...this.config.globalRules];

    const collectionConfig = this.config.collections[resourceType];
    if (collectionConfig) {
      rules.push(...collectionConfig.rules);
    }

    return rules;
  }

  /**
   * Get applicable RLS policies for a collection
   */
  private getApplicableRLSPolicies(collection: string, action: PermissionAction): RLSPolicy[] {
    const collectionConfig = this.config.collections[collection];
    if (!collectionConfig) return [];

    return collectionConfig.rlsPolicies.filter((p) => p.enabled && p.actions.includes(action));
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    userContext: UserContext,
    action: PermissionAction,
    resource: Resource
  ): string {
    return `${userContext.id}:${action}:${resource.type}:${resource.id ?? '*'}`;
  }

  /**
   * Cache a permission result
   */
  private cacheResult(
    userContext: UserContext,
    action: PermissionAction,
    resource: Resource,
    result: PermissionCheckResult
  ): void {
    if (!this.config.cacheEnabled) return;

    const cacheKey = this.getCacheKey(userContext, action, resource);
    this.cache.set(cacheKey, {
      result,
      expiresAt: Date.now() + (this.config.cacheTTL ?? 60000),
    });
  }

  /**
   * Clear the permission cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the current configuration
   */
  getConfig(): PermissionConfig {
    return this.config;
  }
}

/**
 * Create a permission evaluator
 */
export function createPermissionEvaluator(config?: Partial<PermissionConfig>): PermissionEvaluator {
  return new PermissionEvaluator(config);
}
