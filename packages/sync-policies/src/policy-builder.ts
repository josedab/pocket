/**
 * @pocket/sync-policies — Fluent DSL for building selective sync policies.
 *
 * @example
 * ```ts
 * const policy = syncPolicy('mobile-optimized')
 *   .description('Bandwidth-optimized policy for mobile clients')
 *   .collection('messages')
 *     .direction('both')
 *     .priority('high')
 *     .filter(f => f.field('createdAt').gte(Date.now() - 7 * 86400000))
 *     .includeFields('id', 'text', 'senderId', 'createdAt')
 *     .conflictStrategy('latest-wins')
 *     .done()
 *   .collection('attachments')
 *     .direction('pull')
 *     .priority('low')
 *     .filter(f => f.field('size').lt(1024 * 1024))
 *     .done()
 *   .userScope('admin', u => u.roles('admin').override('messages', { priority: 'critical' }))
 *   .bandwidth({ mode: 'metered', maxBytesPerSync: 5 * 1024 * 1024 })
 *   .build();
 * ```
 *
 * @module @pocket/sync-policies
 */

import type {
  BandwidthConfig,
  CollectionPolicyDefinition,
  ConflictStrategy,
  FilterExpression,
  GlobalPolicyConfig,
  SyncDirection,
  SyncPolicyDefinition,
  SyncPriority,
  UserCondition,
  UserScopeDefinition,
} from './types.js';

// ── Filter Builder ────────────────────────────────────────

export class FilterBuilder {
  private expr: FilterExpression | null = null;

  field(name: string): FieldFilterBuilder {
    return new FieldFilterBuilder(this, name);
  }

  and(...builders: ((fb: FilterBuilder) => FilterBuilder)[]): FilterBuilder {
    const conditions = builders.map((fn) => {
      const b = fn(new FilterBuilder());
      if (!b.expr) throw new Error('Empty filter in and() clause');
      return b.expr;
    });
    this.expr = { type: 'and', conditions };
    return this;
  }

  or(...builders: ((fb: FilterBuilder) => FilterBuilder)[]): FilterBuilder {
    const conditions = builders.map((fn) => {
      const b = fn(new FilterBuilder());
      if (!b.expr) throw new Error('Empty filter in or() clause');
      return b.expr;
    });
    this.expr = { type: 'or', conditions };
    return this;
  }

  not(builder: (fb: FilterBuilder) => FilterBuilder): FilterBuilder {
    const b = builder(new FilterBuilder());
    if (!b.expr) throw new Error('Empty filter in not() clause');
    this.expr = { type: 'not', conditions: [b.expr] };
    return this;
  }

  since(field: string, time: number | string): FilterBuilder {
    this.expr = { type: 'time', field, since: time };
    return this;
  }

  custom(name: string, params?: Record<string, unknown>): FilterBuilder {
    this.expr = { type: 'custom', name, params };
    return this;
  }

  /** @internal */
  _setExpr(expr: FilterExpression): void {
    this.expr = expr;
  }

  /** @internal */
  _getExpr(): FilterExpression | null {
    return this.expr;
  }
}

export class FieldFilterBuilder {
  constructor(
    private readonly parent: FilterBuilder,
    private readonly fieldName: string,
  ) {}

  eq(value: unknown): FilterBuilder {
    this.parent._setExpr({ type: 'comparison', field: this.fieldName, operator: 'eq', value });
    return this.parent;
  }

  ne(value: unknown): FilterBuilder {
    this.parent._setExpr({ type: 'comparison', field: this.fieldName, operator: 'ne', value });
    return this.parent;
  }

  gt(value: unknown): FilterBuilder {
    this.parent._setExpr({ type: 'comparison', field: this.fieldName, operator: 'gt', value });
    return this.parent;
  }

  gte(value: unknown): FilterBuilder {
    this.parent._setExpr({ type: 'comparison', field: this.fieldName, operator: 'gte', value });
    return this.parent;
  }

  lt(value: unknown): FilterBuilder {
    this.parent._setExpr({ type: 'comparison', field: this.fieldName, operator: 'lt', value });
    return this.parent;
  }

  lte(value: unknown): FilterBuilder {
    this.parent._setExpr({ type: 'comparison', field: this.fieldName, operator: 'lte', value });
    return this.parent;
  }

  in(values: unknown[]): FilterBuilder {
    this.parent._setExpr({ type: 'in', field: this.fieldName, values });
    return this.parent;
  }

  notIn(values: unknown[]): FilterBuilder {
    this.parent._setExpr({ type: 'in', field: this.fieldName, values, negate: true });
    return this.parent;
  }

  exists(val = true): FilterBuilder {
    this.parent._setExpr({ type: 'exists', field: this.fieldName, exists: val });
    return this.parent;
  }
}

// ── Collection Builder ────────────────────────────────────

export class CollectionPolicyBuilder {
  private readonly def: CollectionPolicyDefinition;

  constructor(
    private readonly parent: SyncPolicyBuilder,
    collection: string,
  ) {
    this.def = {
      collection,
      direction: 'both',
      priority: 'normal',
      enabled: true,
    };
  }

  direction(dir: SyncDirection): this {
    this.def.direction = dir;
    return this;
  }

  priority(p: SyncPriority): this {
    this.def.priority = p;
    return this;
  }

  filter(fn: (fb: FilterBuilder) => FilterBuilder): this {
    const fb = fn(new FilterBuilder());
    const expr = fb._getExpr();
    if (expr) {
      this.def.filter = expr;
    }
    return this;
  }

  includeFields(...fields: string[]): this {
    this.def.fields = { mode: 'include', fields };
    return this;
  }

  excludeFields(...fields: string[]): this {
    this.def.fields = { mode: 'exclude', fields };
    return this;
  }

  conflictStrategy(strategy: ConflictStrategy): this {
    this.def.conflictStrategy = strategy;
    return this;
  }

  batchSize(size: number): this {
    if (size < 1) throw new Error('Batch size must be positive');
    this.def.batchSize = size;
    return this;
  }

  rateLimit(maxPerMinute: number): this {
    if (maxPerMinute < 1) throw new Error('Rate limit must be positive');
    this.def.rateLimit = maxPerMinute;
    return this;
  }

  ttl(ms: number): this {
    if (ms < 0) throw new Error('TTL must be non-negative');
    this.def.ttl = ms;
    return this;
  }

  disabled(): this {
    this.def.enabled = false;
    return this;
  }

  /** Finish this collection config and return to the policy builder */
  done(): SyncPolicyBuilder {
    this.parent._addCollection(this.def);
    return this.parent;
  }
}

// ── User Scope Builder ────────────────────────────────────

export class UserScopeBuilder {
  private readonly condition: UserCondition = {};
  private readonly overridesList: { collection: string; overrides: Partial<CollectionPolicyDefinition> }[] = [];

  roles(...roles: string[]): this {
    this.condition.roles = roles;
    return this;
  }

  property(key: string, value: unknown): this {
    if (!this.condition.properties) this.condition.properties = {};
    this.condition.properties[key] = value;
    return this;
  }

  customCondition(expr: string): this {
    this.condition.custom = expr;
    return this;
  }

  override(collection: string, overrides: Partial<CollectionPolicyDefinition>): this {
    this.overridesList.push({ collection, overrides });
    return this;
  }

  /** @internal */
  _build(name: string): UserScopeDefinition[] {
    return this.overridesList.map((o) => ({
      name: `${name}:${o.collection}`,
      condition: { ...this.condition },
      overrides: { collection: o.collection, ...o.overrides },
    }));
  }
}

// ── Policy Builder (top-level DSL) ────────────────────────

export class SyncPolicyBuilder {
  private readonly policyName: string;
  private policyDescription?: string;
  private policyVersion = 1;
  private readonly collections: CollectionPolicyDefinition[] = [];
  private readonly userScopes: UserScopeDefinition[] = [];
  private globals?: GlobalPolicyConfig;
  private bw?: BandwidthConfig;

  constructor(name: string) {
    if (!name || name.trim().length === 0) {
      throw new Error('Policy name is required');
    }
    this.policyName = name;
  }

  description(desc: string): this {
    this.policyDescription = desc;
    return this;
  }

  version(v: number): this {
    if (v < 1) throw new Error('Version must be >= 1');
    this.policyVersion = v;
    return this;
  }

  collection(name: string): CollectionPolicyBuilder {
    return new CollectionPolicyBuilder(this, name);
  }

  defaults(config: Partial<GlobalPolicyConfig>): this {
    this.globals = {
      defaultDirection: config.defaultDirection ?? 'both',
      defaultPriority: config.defaultPriority ?? 'normal',
      defaultConflictStrategy: config.defaultConflictStrategy ?? 'latest-wins',
      maxBatchSize: config.maxBatchSize ?? 100,
      maxDocumentSizeBytes: config.maxDocumentSizeBytes ?? 1024 * 1024,
      syncIntervalMs: config.syncIntervalMs ?? 5000,
      enableCompression: config.enableCompression ?? true,
    };
    return this;
  }

  userScope(name: string, fn: (ub: UserScopeBuilder) => UserScopeBuilder): this {
    const builder = fn(new UserScopeBuilder());
    this.userScopes.push(...builder._build(name));
    return this;
  }

  bandwidth(config: BandwidthConfig): this {
    this.bw = config;
    return this;
  }

  /** @internal */
  _addCollection(def: CollectionPolicyDefinition): void {
    // Replace if already defined
    const idx = this.collections.findIndex((c) => c.collection === def.collection);
    if (idx >= 0) {
      this.collections[idx] = def;
    } else {
      this.collections.push(def);
    }
  }

  /** Build the final policy definition */
  build(): SyncPolicyDefinition {
    if (this.collections.length === 0) {
      throw new Error(`Policy "${this.policyName}" has no collections configured`);
    }

    return {
      name: this.policyName,
      description: this.policyDescription,
      version: this.policyVersion,
      collections: [...this.collections],
      globals: this.globals,
      userScopes: this.userScopes.length > 0 ? this.userScopes : undefined,
      bandwidthConfig: this.bw,
    };
  }
}

// ── Entry Point ───────────────────────────────────────────

/** Start building a sync policy with the fluent DSL */
export function syncPolicy(name: string): SyncPolicyBuilder {
  return new SyncPolicyBuilder(name);
}
