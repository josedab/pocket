/**
 * @pocket/sync-policies — Policy evaluator: applies sync policies to documents.
 *
 * @module @pocket/sync-policies
 */

import type {
  CollectionPolicyDefinition,
  FilterExpression,
  PolicyEvaluationResult,
  SyncPolicyDefinition,
  UserCondition,
} from './types.js';

// ── Filter Evaluator ──────────────────────────────────────

export function evaluateFilter(
  filter: FilterExpression,
  doc: Record<string, unknown>,
): boolean {
  switch (filter.type) {
    case 'comparison': {
      const docValue = getNestedValue(doc, filter.field);
      return evaluateComparison(docValue, filter.operator, filter.value);
    }
    case 'and':
      return filter.conditions.every((c) => evaluateFilter(c, doc));
    case 'or':
      return filter.conditions.some((c) => evaluateFilter(c, doc));
    case 'not':
      return !filter.conditions.some((c) => evaluateFilter(c, doc));
    case 'exists':
      return filter.exists
        ? getNestedValue(doc, filter.field) !== undefined
        : getNestedValue(doc, filter.field) === undefined;
    case 'in': {
      const val = getNestedValue(doc, filter.field);
      const found = filter.values.includes(val);
      return filter.negate ? !found : found;
    }
    case 'time': {
      const fieldVal = getNestedValue(doc, filter.field);
      const ts = typeof fieldVal === 'number' ? fieldVal : typeof fieldVal === 'string' ? new Date(fieldVal).getTime() : NaN;
      if (isNaN(ts)) return false;
      const sinceTs = filter.since ? (typeof filter.since === 'number' ? filter.since : new Date(filter.since).getTime()) : -Infinity;
      const untilTs = filter.until ? (typeof filter.until === 'number' ? filter.until : new Date(filter.until).getTime()) : Infinity;
      return ts >= sinceTs && ts <= untilTs;
    }
    case 'custom':
      // Custom filters are evaluated externally; default to passing
      return true;
    default:
      return true;
  }
}

function evaluateComparison(
  docValue: unknown,
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte',
  targetValue: unknown,
): boolean {
  switch (operator) {
    case 'eq': return docValue === targetValue;
    case 'ne': return docValue !== targetValue;
    case 'gt': return (docValue as number) > (targetValue as number);
    case 'gte': return (docValue as number) >= (targetValue as number);
    case 'lt': return (docValue as number) < (targetValue as number);
    case 'lte': return (docValue as number) <= (targetValue as number);
    default: return false;
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Policy Evaluator ──────────────────────────────────────

export interface UserContext {
  roles?: string[];
  properties?: Record<string, unknown>;
  id?: string;
}

/**
 * Evaluates sync policies against documents, applying user scopes and filters.
 */
export class PolicyEvaluator {
  private readonly policy: SyncPolicyDefinition;

  constructor(policy: SyncPolicyDefinition) {
    this.policy = policy;
  }

  /**
   * Evaluate whether a document in a collection should sync.
   */
  evaluate(
    collection: string,
    doc: Record<string, unknown>,
    user?: UserContext,
  ): PolicyEvaluationResult {
    const colPolicy = this.getCollectionPolicy(collection, user);

    if (!colPolicy) {
      return {
        shouldSync: false,
        direction: 'none',
        priority: 'normal',
        conflictStrategy: this.policy.globals?.defaultConflictStrategy ?? 'latest-wins',
        matchedRules: [],
        reason: `Collection "${collection}" not in policy`,
      };
    }

    if (!colPolicy.enabled) {
      return {
        shouldSync: false,
        direction: 'none',
        priority: colPolicy.priority,
        conflictStrategy: colPolicy.conflictStrategy ?? 'latest-wins',
        matchedRules: ['disabled'],
        reason: `Collection "${collection}" is disabled`,
      };
    }

    // Evaluate filter
    if (colPolicy.filter) {
      const passes = evaluateFilter(colPolicy.filter, doc);
      if (!passes) {
        return {
          shouldSync: false,
          direction: colPolicy.direction,
          priority: colPolicy.priority,
          conflictStrategy: colPolicy.conflictStrategy ?? 'latest-wins',
          matchedRules: ['filter'],
          reason: 'Document did not pass collection filter',
        };
      }
    }

    // Apply field projections
    const filteredFields = colPolicy.fields
      ? colPolicy.fields.mode === 'include'
        ? colPolicy.fields.fields
        : Object.keys(doc).filter((k) => !colPolicy.fields!.fields.includes(k))
      : undefined;

    return {
      shouldSync: true,
      direction: colPolicy.direction,
      priority: colPolicy.priority,
      conflictStrategy: colPolicy.conflictStrategy ?? this.policy.globals?.defaultConflictStrategy ?? 'latest-wins',
      filteredFields,
      matchedRules: [colPolicy.collection],
      reason: 'Document matches policy',
    };
  }

  /**
   * Evaluate all documents in a collection, returning sync/skip decisions.
   */
  evaluateBatch(
    collection: string,
    docs: Record<string, unknown>[],
    user?: UserContext,
  ): { sync: Record<string, unknown>[]; skip: Record<string, unknown>[] } {
    const sync: Record<string, unknown>[] = [];
    const skip: Record<string, unknown>[] = [];

    for (const doc of docs) {
      const result = this.evaluate(collection, doc, user);
      if (result.shouldSync) {
        sync.push(result.filteredFields ? projectFields(doc, result.filteredFields) : doc);
      } else {
        skip.push(doc);
      }
    }

    return { sync, skip };
  }

  /** Get the ordered list of collections to sync based on priority */
  getSyncOrder(): string[] {
    const priorityRank: Record<string, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
      background: 4,
    };

    return [...this.policy.collections]
      .filter((c) => c.enabled)
      .sort((a, b) => (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2))
      .map((c) => c.collection);
  }

  private getCollectionPolicy(
    collection: string,
    user?: UserContext,
  ): CollectionPolicyDefinition | null {
    const base = this.policy.collections.find((c) => c.collection === collection);
    if (!base) return null;

    // Apply user scope overrides
    if (user && this.policy.userScopes) {
      for (const scope of this.policy.userScopes) {
        if (matchesUserCondition(scope.condition, user) && scope.overrides.collection === collection) {
          return { ...base, ...scope.overrides, collection };
        }
      }
    }

    return base;
  }
}

function matchesUserCondition(condition: UserCondition, user: UserContext): boolean {
  if (condition.roles && condition.roles.length > 0) {
    const userRoles = user.roles ?? [];
    if (!condition.roles.some((r) => userRoles.includes(r))) {
      return false;
    }
  }

  if (condition.properties) {
    const userProps = user.properties ?? {};
    for (const [key, value] of Object.entries(condition.properties)) {
      if (userProps[key] !== value) return false;
    }
  }

  return true;
}

function projectFields(
  doc: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in doc) {
      result[field] = doc[field];
    }
  }
  return result;
}

// ── Factory ───────────────────────────────────────────────

/** Create a policy evaluator from a policy definition */
export function createPolicyEvaluator(policy: SyncPolicyDefinition): PolicyEvaluator {
  return new PolicyEvaluator(policy);
}
