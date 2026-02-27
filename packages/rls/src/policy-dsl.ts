/**
 * Declarative Policy DSL for row-level access control.
 * Supports role-based, attribute-based, and tenant-isolation patterns.
 */

export type PolicyEffect = 'allow' | 'deny';
export type PolicyAction = 'read' | 'create' | 'update' | 'delete' | '*';

export interface PolicyCondition {
  field: string;
  operator:
    | '$eq'
    | '$ne'
    | '$gt'
    | '$gte'
    | '$lt'
    | '$lte'
    | '$in'
    | '$nin'
    | '$exists'
    | '$regex'
    | '$contains';
  value: unknown;
  /** If true, value references a context field instead of a literal */
  contextRef?: boolean;
}

export interface PolicyRule {
  id: string;
  name: string;
  description?: string;
  effect: PolicyEffect;
  actions: PolicyAction[];
  collections: string[];
  conditions: PolicyCondition[];
  roles?: string[];
  priority: number;
  enabled: boolean;
}

export interface PolicySet {
  name: string;
  description?: string;
  defaultEffect: PolicyEffect;
  rules: PolicyRule[];
  version: number;
}

export interface RLSContext {
  userId: string;
  roles: string[];
  tenantId?: string;
  attributes: Record<string, unknown>;
}

/**
 * Fluent builder for constructing RLS policies.
 */
export class PolicyDSL {
  private rules: PolicyRule[] = [];
  private defaultEffect: PolicyEffect = 'deny';
  private name = 'default';
  private description?: string;
  private version = 1;

  static create(name: string): PolicyDSL {
    const dsl = new PolicyDSL();
    dsl.name = name;
    return dsl;
  }

  setDescription(description: string): this {
    this.description = description;
    return this;
  }

  setDefaultEffect(effect: PolicyEffect): this {
    this.defaultEffect = effect;
    return this;
  }

  setVersion(version: number): this {
    this.version = version;
    return this;
  }

  /** Add an allow rule */
  allow(actions: PolicyAction | PolicyAction[]): PolicyRuleBuilder {
    const actionsArr = Array.isArray(actions) ? actions : [actions];
    return new PolicyRuleBuilder(this, 'allow', actionsArr);
  }

  /** Add a deny rule */
  deny(actions: PolicyAction | PolicyAction[]): PolicyRuleBuilder {
    const actionsArr = Array.isArray(actions) ? actions : [actions];
    return new PolicyRuleBuilder(this, 'deny', actionsArr);
  }

  /** Allow all actions for specific roles */
  allowRoles(...roles: string[]): PolicyRuleBuilder {
    return new PolicyRuleBuilder(this, 'allow', ['*']).forRoles(...roles);
  }

  /** Tenant isolation shorthand */
  tenantIsolation(tenantField = 'tenantId'): this {
    this.addRule({
      id: `tenant-isolation-${tenantField}`,
      name: 'Tenant Isolation',
      description: `Restrict access to documents matching user tenant via ${tenantField}`,
      effect: 'allow',
      actions: ['*'],
      collections: ['*'],
      conditions: [{ field: tenantField, operator: '$eq', value: 'tenantId', contextRef: true }],
      roles: [],
      priority: 100,
      enabled: true,
    });
    return this;
  }

  /** Owner-only access shorthand */
  ownerOnly(ownerField = 'ownerId'): this {
    this.addRule({
      id: `owner-only-${ownerField}`,
      name: 'Owner Only',
      description: `Only document owner can access`,
      effect: 'allow',
      actions: ['*'],
      collections: ['*'],
      conditions: [{ field: ownerField, operator: '$eq', value: 'userId', contextRef: true }],
      roles: [],
      priority: 90,
      enabled: true,
    });
    return this;
  }

  /** @internal */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  /** Build the policy set */
  build(): PolicySet {
    return {
      name: this.name,
      description: this.description,
      defaultEffect: this.defaultEffect,
      rules: [...this.rules],
      version: this.version,
    };
  }
}

/**
 * Builder for individual policy rules.
 */
export class PolicyRuleBuilder {
  private readonly dsl: PolicyDSL;
  private readonly rule: PolicyRule;

  constructor(dsl: PolicyDSL, effect: PolicyEffect, actions: PolicyAction[]) {
    this.dsl = dsl;
    this.rule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      effect,
      actions,
      collections: ['*'],
      conditions: [],
      roles: [],
      priority: 50,
      enabled: true,
    };
  }

  /** Set rule ID */
  id(id: string): this {
    this.rule.id = id;
    return this;
  }

  /** Set rule name */
  named(name: string): this {
    this.rule.name = name;
    return this;
  }

  /** Set rule description */
  described(description: string): this {
    this.rule.description = description;
    return this;
  }

  /** Restrict to specific collections */
  on(...collections: string[]): this {
    this.rule.collections = collections;
    return this;
  }

  /** Require specific roles */
  forRoles(...roles: string[]): this {
    this.rule.roles = roles;
    return this;
  }

  /** Add a condition on the document */
  where(field: string, operator: PolicyCondition['operator'], value: unknown): this {
    this.rule.conditions.push({ field, operator, value });
    return this;
  }

  /** Add a condition referencing the auth context */
  whereContext(field: string, operator: PolicyCondition['operator'], contextField: string): this {
    this.rule.conditions.push({ field, operator, value: contextField, contextRef: true });
    return this;
  }

  /** Set priority (higher = evaluated first) */
  withPriority(priority: number): this {
    this.rule.priority = priority;
    return this;
  }

  /** Disable this rule */
  disabled(): this {
    this.rule.enabled = false;
    return this;
  }

  /** Finalize and add the rule, returning the DSL for chaining */
  done(): PolicyDSL {
    this.dsl.addRule(this.rule);
    return this.dsl;
  }
}

/**
 * Evaluates a policy set against a document and context.
 */
export class PolicyEvaluator {
  private readonly policySet: PolicySet;

  constructor(policySet: PolicySet) {
    this.policySet = policySet;
  }

  /** Check if an action is allowed */
  evaluate(
    action: PolicyAction,
    collection: string,
    document: Record<string, unknown>,
    context: RLSContext
  ): boolean {
    // Get applicable rules sorted by priority (highest first)
    const applicable = this.policySet.rules
      .filter((r) => r.enabled)
      .filter((r) => r.actions.includes('*') || r.actions.includes(action))
      .filter((r) => r.collections.includes('*') || r.collections.includes(collection))
      .sort((a, b) => b.priority - a.priority);

    for (const rule of applicable) {
      // Check roles
      if (rule.roles && rule.roles.length > 0) {
        if (!rule.roles.some((role) => context.roles.includes(role))) {
          continue; // Role doesn't match, skip rule
        }
      }

      // Check conditions
      if (this.matchesConditions(rule.conditions, document, context)) {
        return rule.effect === 'allow';
      }
    }

    return this.policySet.defaultEffect === 'allow';
  }

  /** Filter a list of documents based on policies */
  filter(
    action: PolicyAction,
    collection: string,
    documents: Record<string, unknown>[],
    context: RLSContext
  ): Record<string, unknown>[] {
    return documents.filter((doc) => this.evaluate(action, collection, doc, context));
  }

  /** Generate a query filter that can be applied at the database level */
  generateQueryFilter(
    action: PolicyAction,
    collection: string,
    context: RLSContext
  ): Record<string, unknown> {
    const filters: Record<string, unknown> = {};

    const applicable = this.policySet.rules
      .filter((r) => r.enabled && r.effect === 'allow')
      .filter((r) => r.actions.includes('*') || r.actions.includes(action))
      .filter((r) => r.collections.includes('*') || r.collections.includes(collection))
      .sort((a, b) => b.priority - a.priority);

    for (const rule of applicable) {
      // Check roles first
      if (rule.roles && rule.roles.length > 0) {
        if (!rule.roles.some((role) => context.roles.includes(role))) continue;
      }

      for (const cond of rule.conditions) {
        const value = cond.contextRef
          ? this.resolveContextValue(String(cond.value), context)
          : cond.value;
        if (cond.operator === '$eq') {
          filters[cond.field] = value;
        } else {
          filters[cond.field] = { [cond.operator]: value };
        }
      }
    }

    return filters;
  }

  private matchesConditions(
    conditions: PolicyCondition[],
    doc: Record<string, unknown>,
    context: RLSContext
  ): boolean {
    if (conditions.length === 0) return true;

    for (const cond of conditions) {
      const docValue = doc[cond.field];
      const compareValue = cond.contextRef
        ? this.resolveContextValue(String(cond.value), context)
        : cond.value;

      if (!this.evaluateCondition(docValue, cond.operator, compareValue)) {
        return false;
      }
    }
    return true;
  }

  private evaluateCondition(
    docValue: unknown,
    operator: PolicyCondition['operator'],
    compareValue: unknown
  ): boolean {
    switch (operator) {
      case '$eq':
        return docValue === compareValue;
      case '$ne':
        return docValue !== compareValue;
      case '$gt':
        return typeof docValue === 'number' && docValue > (compareValue as number);
      case '$gte':
        return typeof docValue === 'number' && docValue >= (compareValue as number);
      case '$lt':
        return typeof docValue === 'number' && docValue < (compareValue as number);
      case '$lte':
        return typeof docValue === 'number' && docValue <= (compareValue as number);
      case '$in':
        return Array.isArray(compareValue) && compareValue.includes(docValue);
      case '$nin':
        return Array.isArray(compareValue) && !compareValue.includes(docValue);
      case '$exists':
        return compareValue ? docValue !== undefined : docValue === undefined;
      case '$regex':
        return typeof docValue === 'string' && new RegExp(String(compareValue)).test(docValue);
      case '$contains':
        return Array.isArray(docValue) && docValue.includes(compareValue);
      default:
        return false;
    }
  }

  private resolveContextValue(path: string, context: RLSContext): unknown {
    if (path === 'userId') return context.userId;
    if (path === 'tenantId') return context.tenantId;
    if (path.startsWith('attributes.')) {
      return context.attributes[path.substring(11)];
    }
    if (path === 'roles') return context.roles;
    return context.attributes[path];
  }
}

export function createPolicyDSL(name: string): PolicyDSL {
  return PolicyDSL.create(name);
}

export function createPolicyEvaluator(policySet: PolicySet): PolicyEvaluator {
  return new PolicyEvaluator(policySet);
}
