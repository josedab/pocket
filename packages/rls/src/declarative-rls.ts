/**
 * DeclarativeRLS — Enhanced row-level security with declarative policy DSL
 * and storage-layer middleware integration.
 *
 * Extends the base PolicyEngine with a fluent policy builder,
 * compiled predicate evaluation, and policy sync support.
 */

import type { AuthContext, PolicyAction, PolicyEffect, PolicyEvaluationResult } from './types.js';

// ── Types ──────────────────────────────────────────────────

export interface DeclarativePolicy {
  name: string;
  collection: string;
  actions: PolicyAction[];
  effect: PolicyEffect;
  priority: number;
  /** Compiled evaluation function */
  evaluate: (authContext: AuthContext, document: Record<string, unknown>) => boolean;
  /** Original rule expression for serialization */
  expression: string;
}

export interface PolicyBuilderConfig {
  defaultEffect?: PolicyEffect;
  enableAuditLog?: boolean;
  stalePolicyToleranceMs?: number;
}

export interface PolicyAuditEntry {
  timestamp: number;
  action: PolicyAction;
  collection: string;
  documentId: string;
  userId: string;
  allowed: boolean;
  policyName: string;
  evaluationTimeMs: number;
}

export interface DeclarativeRLSStats {
  totalEvaluations: number;
  allowedCount: number;
  deniedCount: number;
  avgEvaluationTimeMs: number;
  policyCount: number;
  auditLogSize: number;
}

// ── Policy Builder (Fluent DSL) ───────────────────────────

export class PolicyBuilder {
  private _name = '';
  private _collection = '';
  private _actions: PolicyAction[] = [];
  private _effect: PolicyEffect = 'allow';
  private _priority = 0;
  private _conditions: ((ctx: AuthContext, doc: Record<string, unknown>) => boolean)[] = [];
  private _expression = '';

  /** Set policy name */
  name(name: string): this {
    this._name = name;
    return this;
  }

  /** Set target collection */
  collection(collection: string): this {
    this._collection = collection;
    return this;
  }

  /** Set allowed actions */
  actions(...actions: PolicyAction[]): this {
    this._actions = actions;
    return this;
  }

  /** Set to allow effect */
  allow(): this {
    this._effect = 'allow';
    return this;
  }

  /** Set to deny effect */
  deny(): this {
    this._effect = 'deny';
    return this;
  }

  /** Set priority (higher = evaluated first) */
  priority(p: number): this {
    this._priority = p;
    return this;
  }

  /**
   * Add a condition: document field must equal auth context field.
   * @example .where('tenantId', 'eq', 'ctx.tenantId')
   */
  where(docField: string, op: 'eq' | 'ne' | 'in', ctxExpr: string): this {
    this._expression += `${docField} ${op} ${ctxExpr}; `;

    this._conditions.push((ctx, doc) => {
      const docValue = doc[docField];
      const ctxValue = this.resolveCtxExpression(ctx, ctxExpr);

      switch (op) {
        case 'eq':
          return docValue === ctxValue;
        case 'ne':
          return docValue !== ctxValue;
        case 'in':
          return Array.isArray(ctxValue) && ctxValue.includes(docValue);
        default:
          return false;
      }
    });
    return this;
  }

  /**
   * Add a role requirement.
   */
  requireRole(...roles: string[]): this {
    this._expression += `role in [${roles.join(',')}]; `;
    this._conditions.push((ctx) => roles.some((r) => ctx.roles.includes(r)));
    return this;
  }

  /**
   * Add a tenant isolation rule.
   */
  tenantIsolation(field = '_tenantId'): this {
    this._expression += `${field} == ctx.tenantId; `;
    this._conditions.push((ctx, doc) => doc[field] === ctx.tenantId);
    return this;
  }

  /**
   * Add a custom predicate.
   */
  custom(
    fn: (ctx: AuthContext, doc: Record<string, unknown>) => boolean,
    description = 'custom'
  ): this {
    this._expression += `${description}; `;
    this._conditions.push(fn);
    return this;
  }

  /**
   * Build the declarative policy.
   */
  build(): DeclarativePolicy {
    if (!this._name) throw new Error('Policy name is required');
    if (!this._collection) throw new Error('Policy collection is required');
    if (this._actions.length === 0) throw new Error('At least one action is required');

    const conditions = [...this._conditions];

    return {
      name: this._name,
      collection: this._collection,
      actions: this._actions,
      effect: this._effect,
      priority: this._priority,
      expression: this._expression.trim(),
      evaluate: (ctx, doc) => conditions.every((c) => c(ctx, doc)),
    };
  }

  private resolveCtxExpression(ctx: AuthContext, expr: string): unknown {
    const path = expr.replace(/^ctx\./, '');
    switch (path) {
      case 'userId':
        return ctx.userId;
      case 'tenantId':
        return ctx.tenantId;
      case 'roles':
        return ctx.roles;
      default:
        return ctx.metadata[path];
    }
  }
}

// ── Declarative RLS Engine ────────────────────────────────

export class DeclarativeRLS {
  private readonly policies = new Map<string, DeclarativePolicy>();
  private readonly config: Required<PolicyBuilderConfig>;
  private readonly auditLog: PolicyAuditEntry[] = [];

  private totalEvaluations = 0;
  private allowedCount = 0;
  private deniedCount = 0;
  private evalTimes: number[] = [];

  constructor(config: PolicyBuilderConfig = {}) {
    this.config = {
      defaultEffect: config.defaultEffect ?? 'deny',
      enableAuditLog: config.enableAuditLog ?? false,
      stalePolicyToleranceMs: config.stalePolicyToleranceMs ?? 7 * 24 * 60 * 60 * 1000,
    };
  }

  /**
   * Register a policy built with PolicyBuilder.
   */
  addPolicy(policy: DeclarativePolicy): void {
    this.policies.set(policy.name, policy);
  }

  /**
   * Remove a policy by name.
   */
  removePolicy(name: string): void {
    this.policies.delete(name);
  }

  /**
   * Evaluate access for an action on a document.
   */
  evaluate(
    action: PolicyAction,
    collection: string,
    document: Record<string, unknown>,
    authContext: AuthContext
  ): PolicyEvaluationResult {
    const start = performance.now();
    this.totalEvaluations++;

    const applicable = this.getApplicable(action, collection);

    if (applicable.length === 0) {
      const allowed = this.config.defaultEffect === 'allow';
      this.trackResult(allowed, start, action, collection, document, authContext, 'default');
      return {
        allowed,
        reason: `No matching policies; default effect is '${this.config.defaultEffect}'`,
      };
    }

    // Evaluate in priority order (highest first)
    for (const policy of applicable) {
      const matches = policy.evaluate(authContext, document);

      if (matches) {
        const allowed = policy.effect === 'allow';
        this.trackResult(allowed, start, action, collection, document, authContext, policy.name);
        return {
          allowed,
          matchedPolicy: {
            name: policy.name,
            collection: policy.collection,
            actions: policy.actions,
            effect: policy.effect,
            conditions: [],
            priority: policy.priority,
          },
          reason: `Policy "${policy.name}" ${policy.effect}s ${action} on "${collection}"`,
        };
      }
    }

    const allowed = this.config.defaultEffect === 'allow';
    this.trackResult(
      allowed,
      start,
      action,
      collection,
      document,
      authContext,
      'default-fallthrough'
    );
    return {
      allowed,
      reason: `No policy matched; default effect is '${this.config.defaultEffect}'`,
    };
  }

  /**
   * Batch evaluate for multiple documents (returns mask).
   */
  filterAllowed(
    action: PolicyAction,
    collection: string,
    documents: Record<string, unknown>[],
    authContext: AuthContext
  ): Record<string, unknown>[] {
    return documents.filter((doc) => this.evaluate(action, collection, doc, authContext).allowed);
  }

  /**
   * Sync policies from a remote source (e.g., server).
   */
  syncPolicies(policies: DeclarativePolicy[]): void {
    this.policies.clear();
    for (const policy of policies) {
      this.policies.set(policy.name, policy);
    }
  }

  /**
   * Get engine statistics.
   */
  getStats(): DeclarativeRLSStats {
    return {
      totalEvaluations: this.totalEvaluations,
      allowedCount: this.allowedCount,
      deniedCount: this.deniedCount,
      avgEvaluationTimeMs:
        this.evalTimes.length > 0
          ? this.evalTimes.reduce((a, b) => a + b, 0) / this.evalTimes.length
          : 0,
      policyCount: this.policies.size,
      auditLogSize: this.auditLog.length,
    };
  }

  /**
   * Get the audit log.
   */
  getAuditLog(): PolicyAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * List all registered policies.
   */
  listPolicies(): DeclarativePolicy[] {
    return [...this.policies.values()].sort((a, b) => b.priority - a.priority);
  }

  // ── Private ────────────────────────────────────────────

  private getApplicable(action: PolicyAction, collection: string): DeclarativePolicy[] {
    return [...this.policies.values()]
      .filter((p) => p.collection === collection && p.actions.includes(action))
      .sort((a, b) => b.priority - a.priority);
  }

  private trackResult(
    allowed: boolean,
    startTime: number,
    action: PolicyAction,
    collection: string,
    document: Record<string, unknown>,
    authContext: AuthContext,
    policyName: string
  ): void {
    const elapsed = performance.now() - startTime;
    this.evalTimes.push(elapsed);
    if (this.evalTimes.length > 100) this.evalTimes.shift();

    if (allowed) this.allowedCount++;
    else this.deniedCount++;

    if (this.config.enableAuditLog) {
      this.auditLog.push({
        timestamp: Date.now(),
        action,
        collection,
        documentId: String(document._id ?? ''),
        userId: authContext.userId,
        allowed,
        policyName,
        evaluationTimeMs: elapsed,
      });
    }
  }
}

/**
 * Create a new policy builder.
 */
export function policy(): PolicyBuilder {
  return new PolicyBuilder();
}

/**
 * Create a DeclarativeRLS engine.
 */
export function createDeclarativeRLS(config?: PolicyBuilderConfig): DeclarativeRLS {
  return new DeclarativeRLS(config);
}
