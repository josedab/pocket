import type { Document } from '@pocket/core';
import type {
  AuthContext,
  Policy,
  PolicyAction,
  PolicyCondition,
  PolicyEvaluationResult,
  RLSConfig,
} from './types.js';
import { DEFAULT_RLS_CONFIG } from './types.js';

/**
 * Evaluates security policies against documents and builds query filters
 * for row-level security enforcement.
 */
export class PolicyEngine {
  private readonly config: RLSConfig;
  private readonly policies: Map<string, Policy>;

  constructor(config: Partial<RLSConfig> = {}) {
    this.config = { ...DEFAULT_RLS_CONFIG, ...config };
    this.policies = new Map();

    for (const policy of this.config.policies) {
      this.policies.set(policy.name, policy);
    }
  }

  /** Register a new policy */
  addPolicy(policy: Policy): void {
    this.policies.set(policy.name, policy);
  }

  /** Remove a policy by name */
  removePolicy(name: string): void {
    this.policies.delete(name);
  }

  /** Evaluate whether an action is allowed on a document */
  evaluate(
    action: PolicyAction,
    collection: string,
    document: Document & Record<string, unknown>,
    authContext: AuthContext,
  ): PolicyEvaluationResult {
    const applicable = this.getApplicablePolicies(action, collection);

    if (applicable.length === 0) {
      return {
        allowed: this.config.defaultEffect === 'allow',
        reason: `No matching policies; default effect is '${this.config.defaultEffect}'`,
      };
    }

    // Check tenant isolation first
    if (this.config.enableTenantIsolation) {
      const tenantValue = document[this.config.tenantField];
      if (tenantValue !== undefined && tenantValue !== authContext.tenantId) {
        return {
          allowed: false,
          reason: 'Tenant isolation: document belongs to a different tenant',
        };
      }
    }

    // Sort by priority descending (higher priority wins)
    const sorted = [...applicable].sort((a, b) => b.priority - a.priority);

    for (const policy of sorted) {
      const allConditionsMet = policy.conditions.every((condition) =>
        this.evaluateCondition(condition, document, authContext),
      );

      if (allConditionsMet) {
        return {
          allowed: policy.effect === 'allow',
          matchedPolicy: policy,
          reason: `Matched policy '${policy.name}' with effect '${policy.effect}'`,
        };
      }
    }

    return {
      allowed: this.config.defaultEffect === 'allow',
      reason: `No policy conditions matched; default effect is '${this.config.defaultEffect}'`,
    };
  }

  /** Get all policies applicable to an action on a collection */
  getApplicablePolicies(action: PolicyAction, collection: string): Policy[] {
    const result: Policy[] = [];
    for (const policy of this.policies.values()) {
      if (
        policy.collection === collection &&
        policy.actions.includes(action)
      ) {
        result.push(policy);
      }
    }
    return result;
  }

  /** Build a query filter object to inject into queries for RLS enforcement */
  buildQueryFilter(
    action: PolicyAction,
    collection: string,
    authContext: AuthContext,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    // Inject tenant isolation filter
    if (this.config.enableTenantIsolation) {
      filter[this.config.tenantField] = authContext.tenantId;
    }

    const applicable = this.getApplicablePolicies(action, collection);
    const allowPolicies = applicable
      .filter((p) => p.effect === 'allow')
      .sort((a, b) => b.priority - a.priority);

    for (const policy of allowPolicies) {
      for (const condition of policy.conditions) {
        if (condition.field.startsWith('auth.')) {
          // Auth-context conditions are checked at evaluation time, not in filters
          continue;
        }

        switch (condition.operator) {
          case '$eq':
            filter[condition.field] = condition.value;
            break;
          case '$ne':
            filter[condition.field] = { $ne: condition.value };
            break;
          case '$in':
            filter[condition.field] = { $in: condition.value };
            break;
          case '$nin':
            filter[condition.field] = { $nin: condition.value };
            break;
          case '$exists':
            filter[condition.field] = { $exists: condition.value };
            break;
        }
      }
    }

    return filter;
  }

  /** Evaluate a single condition against a document and auth context */
  private evaluateCondition(
    condition: PolicyCondition,
    document: Document & Record<string, unknown>,
    authContext: AuthContext,
  ): boolean {
    // Resolve the field value — support auth context references
    let fieldValue: unknown;
    if (condition.field === 'auth.userId') {
      fieldValue = authContext.userId;
    } else if (condition.field === 'auth.tenantId') {
      fieldValue = authContext.tenantId;
    } else if (condition.field === 'auth.roles') {
      fieldValue = authContext.roles;
    } else if (condition.field.startsWith('auth.metadata.')) {
      const metaKey = condition.field.slice('auth.metadata.'.length);
      fieldValue = authContext.metadata[metaKey];
    } else {
      fieldValue = document[condition.field];
    }

    switch (condition.operator) {
      case '$eq':
        return fieldValue === condition.value;
      case '$ne':
        return fieldValue !== condition.value;
      case '$in':
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      case '$nin':
        return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
      case '$exists':
        return condition.value ? fieldValue !== undefined : fieldValue === undefined;
      default:
        return false;
    }
  }
}

/** Create a new PolicyEngine instance */
export function createPolicyEngine(config: Partial<RLSConfig> = {}): PolicyEngine {
  return new PolicyEngine(config);
}
