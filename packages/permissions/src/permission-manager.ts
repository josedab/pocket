/**
 * Permission Manager - Manages permission rules and policies
 */

import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import { PermissionEvaluator } from './permission-evaluator.js';
import type {
  AuditLogEntry,
  CollectionPermissions,
  PermissionAction,
  PermissionCheckResult,
  PermissionConfig,
  PermissionEvent,
  PermissionRule,
  Resource,
  RLSPolicy,
  UserContext,
} from './types.js';

/**
 * Generate unique ID
 */
function generateId(): string {
  return `perm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Manages permission rules and policies
 */
export class PermissionManager {
  private config: PermissionConfig;
  private evaluator: PermissionEvaluator;
  private readonly config$ = new BehaviorSubject<PermissionConfig | null>(null);
  private readonly events$ = new Subject<PermissionEvent>();
  private readonly auditLog$ = new Subject<AuditLogEntry>();

  constructor(config: Partial<PermissionConfig> = {}) {
    this.config = {
      defaultPolicy: 'deny',
      globalRules: [],
      collections: {},
      auditEnabled: false,
      cacheEnabled: true,
      cacheTTL: 60000,
      debug: false,
      ...config,
    };
    this.evaluator = new PermissionEvaluator(this.config);
    this.config$.next(this.config);
  }

  /**
   * Check permission
   */
  check(
    userContext: UserContext,
    action: PermissionAction,
    resource: Resource
  ): PermissionCheckResult {
    const result = this.evaluator.checkPermission(userContext, action, resource);

    // Emit event
    this.events$.next({
      type: result.allowed ? 'allow' : 'deny',
      userId: userContext.id,
      resource,
      action,
      result,
      timestamp: Date.now(),
    });

    // Audit log
    if (this.config.auditEnabled) {
      this.logAudit(userContext, action, resource, result);
    }

    return result;
  }

  /**
   * Check if action is allowed (returns boolean)
   */
  can(userContext: UserContext, action: PermissionAction, resource: Resource): boolean {
    return this.check(userContext, action, resource).allowed;
  }

  /**
   * Filter documents based on RLS policies
   */
  filter<T extends Record<string, unknown>>(
    userContext: UserContext,
    collection: string,
    documents: T[],
    action: PermissionAction = 'read'
  ): T[] {
    return this.evaluator.filterDocuments(userContext, collection, documents, action);
  }

  /**
   * Add a global rule
   */
  addRule(rule: Omit<PermissionRule, 'id'>): PermissionRule {
    const newRule: PermissionRule = {
      ...rule,
      id: generateId(),
      enabled: rule.enabled ?? true,
    };

    this.config.globalRules.push(newRule);
    this.updateConfig();

    this.events$.next({
      type: 'rule-added',
      timestamp: Date.now(),
    });

    return newRule;
  }

  /**
   * Remove a global rule
   */
  removeRule(ruleId: string): boolean {
    const index = this.config.globalRules.findIndex((r) => r.id === ruleId);
    if (index === -1) return false;

    this.config.globalRules.splice(index, 1);
    this.updateConfig();

    this.events$.next({
      type: 'rule-removed',
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Add a rule to a collection
   */
  addCollectionRule(collection: string, rule: Omit<PermissionRule, 'id'>): PermissionRule {
    this.ensureCollection(collection);

    const newRule: PermissionRule = {
      ...rule,
      id: generateId(),
      enabled: rule.enabled ?? true,
    };

    this.config.collections[collection]!.rules.push(newRule);
    this.updateConfig();

    return newRule;
  }

  /**
   * Add an RLS policy
   */
  addRLSPolicy(collection: string, policy: Omit<RLSPolicy, 'id'>): RLSPolicy {
    this.ensureCollection(collection);

    const newPolicy: RLSPolicy = {
      ...policy,
      id: generateId(),
      enabled: policy.enabled ?? true,
    };

    this.config.collections[collection]!.rlsPolicies.push(newPolicy);
    this.updateConfig();

    this.events$.next({
      type: 'policy-added',
      timestamp: Date.now(),
    });

    return newPolicy;
  }

  /**
   * Remove an RLS policy
   */
  removeRLSPolicy(collection: string, policyId: string): boolean {
    const collectionConfig = this.config.collections[collection];
    if (!collectionConfig) return false;

    const index = collectionConfig.rlsPolicies.findIndex((p) => p.id === policyId);
    if (index === -1) return false;

    collectionConfig.rlsPolicies.splice(index, 1);
    this.updateConfig();

    this.events$.next({
      type: 'policy-removed',
      timestamp: Date.now(),
    });

    return true;
  }

  /**
   * Set collection permissions
   */
  setCollectionPermissions(collection: string, permissions: Partial<CollectionPermissions>): void {
    this.ensureCollection(collection);

    this.config.collections[collection] = {
      ...this.config.collections[collection]!,
      ...permissions,
    };

    this.updateConfig();
  }

  /**
   * Get collection permissions
   */
  getCollectionPermissions(collection: string): CollectionPermissions | undefined {
    return this.config.collections[collection];
  }

  /**
   * Set default policy
   */
  setDefaultPolicy(policy: 'allow' | 'deny'): void {
    this.config.defaultPolicy = policy;
    this.updateConfig();
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    // Check global rules
    const globalRule = this.config.globalRules.find((r) => r.id === ruleId);
    if (globalRule) {
      globalRule.enabled = enabled;
      this.updateConfig();
      return true;
    }

    // Check collection rules
    for (const collection of Object.values(this.config.collections)) {
      const rule = collection.rules.find((r) => r.id === ruleId);
      if (rule) {
        rule.enabled = enabled;
        this.updateConfig();
        return true;
      }
    }

    return false;
  }

  /**
   * Enable/disable an RLS policy
   */
  setPolicyEnabled(collection: string, policyId: string, enabled: boolean): boolean {
    const collectionConfig = this.config.collections[collection];
    if (!collectionConfig) return false;

    const policy = collectionConfig.rlsPolicies.find((p) => p.id === policyId);
    if (!policy) return false;

    policy.enabled = enabled;
    this.updateConfig();
    return true;
  }

  /**
   * Get all rules
   */
  getRules(): PermissionRule[] {
    const rules = [...this.config.globalRules];

    for (const collection of Object.values(this.config.collections)) {
      rules.push(...collection.rules);
    }

    return rules;
  }

  /**
   * Get all RLS policies
   */
  getRLSPolicies(): RLSPolicy[] {
    const policies: RLSPolicy[] = [];

    for (const collection of Object.values(this.config.collections)) {
      policies.push(...collection.rlsPolicies);
    }

    return policies;
  }

  /**
   * Get configuration observable
   */
  get config$Observable(): Observable<PermissionConfig | null> {
    return this.config$.asObservable();
  }

  /**
   * Get events observable
   */
  get events(): Observable<PermissionEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get audit log observable
   */
  get auditLog(): Observable<AuditLogEntry> {
    return this.auditLog$.asObservable();
  }

  /**
   * Clear permission cache
   */
  clearCache(): void {
    this.evaluator.clearCache();
  }

  /**
   * Get current configuration
   */
  getConfig(): PermissionConfig {
    return this.config;
  }

  /**
   * Load configuration
   */
  loadConfig(config: PermissionConfig): void {
    this.config = config;
    this.updateConfig();
  }

  /**
   * Export configuration as JSON
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import configuration from JSON
   */
  importConfig(json: string): void {
    const config = JSON.parse(json) as PermissionConfig;
    this.loadConfig(config);
  }

  /**
   * Ensure collection exists in config
   */
  private ensureCollection(collection: string): void {
    this.config.collections[collection] ??= {
      collection,
      defaultPolicy: this.config.defaultPolicy,
      rules: [],
      rlsPolicies: [],
    };
  }

  /**
   * Update configuration and recreate evaluator
   */
  private updateConfig(): void {
    this.evaluator = new PermissionEvaluator(this.config);
    this.config$.next(this.config);
  }

  /**
   * Log to audit
   */
  private logAudit(
    userContext: UserContext,
    action: PermissionAction,
    resource: Resource,
    result: PermissionCheckResult
  ): void {
    const entry: AuditLogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      userId: userContext.id,
      action,
      resourceType: resource.type,
      resourceId: resource.id,
      allowed: result.allowed,
      reason: result.reason,
      matchedRuleId: result.matchedRule?.id,
      context: {
        roles: userContext.roles,
        resourceAttributes: resource.attributes,
      },
    };

    this.auditLog$.next(entry);
  }
}

/**
 * Create a permission manager
 */
export function createPermissionManager(config?: Partial<PermissionConfig>): PermissionManager {
  return new PermissionManager(config);
}
