/**
 * Offline RBAC (Role-Based Access Control) evaluator.
 *
 * Evaluates permissions locally using cached JWT claims and a policy
 * definition, enabling authorization checks without network access.
 *
 * @example
 * ```typescript
 * import { OfflineRBAC } from '@pocket/auth';
 *
 * const rbac = new OfflineRBAC({
 *   policies: {
 *     'todos:read': ['user', 'admin'],
 *     'todos:write': ['admin'],
 *     'todos:delete': ['admin'],
 *     'users:read': ['admin'],
 *   },
 * });
 *
 * rbac.setUser({ id: '1', roles: ['user'] });
 *
 * rbac.can('todos:read');   // true
 * rbac.can('todos:write');  // false
 * rbac.can('todos:delete'); // false
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { AuthUser } from './types.js';

// ── Types ──────────────────────────────────────────────────

export interface RBACConfig {
  /** Policy definitions: permission → allowed roles */
  policies: Record<string, string[]>;
  /** Super-admin role that bypasses all checks (default: 'admin') */
  superAdminRole?: string;
  /** Cache TTL for permission evaluations in ms (default: 60000) */
  cacheTtlMs?: number;
  /** Deny by default when no policy matches (default: true) */
  denyByDefault?: boolean;
}

export interface PermissionCheck {
  permission: string;
  granted: boolean;
  reason: string;
  evaluatedAt: number;
}

export interface RBACState {
  user: AuthUser | null;
  policies: Record<string, string[]>;
  lastEvaluatedAt: number;
}

// ── Implementation ────────────────────────────────────────

export class OfflineRBAC {
  private readonly config: Required<RBACConfig>;
  private readonly stateSubject: BehaviorSubject<RBACState>;
  private readonly cache = new Map<string, { result: boolean; expiresAt: number }>();

  private user: AuthUser | null = null;

  /** Observable of the current RBAC state. */
  readonly state$: Observable<RBACState>;

  constructor(config: RBACConfig) {
    this.config = {
      policies: { ...config.policies },
      superAdminRole: config.superAdminRole ?? 'admin',
      cacheTtlMs: config.cacheTtlMs ?? 60000,
      denyByDefault: config.denyByDefault ?? true,
    };

    this.stateSubject = new BehaviorSubject<RBACState>({
      user: null,
      policies: this.config.policies,
      lastEvaluatedAt: 0,
    });
    this.state$ = this.stateSubject.asObservable();
  }

  /**
   * Set the current user for permission evaluation.
   */
  setUser(user: AuthUser | null): void {
    this.user = user;
    this.cache.clear();
    this.stateSubject.next({
      user,
      policies: this.config.policies,
      lastEvaluatedAt: Date.now(),
    });
  }

  /**
   * Check if the current user has a specific permission.
   */
  can(permission: string): boolean {
    return this.evaluate(permission).granted;
  }

  /**
   * Check if the current user has ALL of the specified permissions.
   */
  canAll(permissions: string[]): boolean {
    return permissions.every((p) => this.can(p));
  }

  /**
   * Check if the current user has ANY of the specified permissions.
   */
  canAny(permissions: string[]): boolean {
    return permissions.some((p) => this.can(p));
  }

  /**
   * Evaluate a permission check with detailed reasoning.
   */
  evaluate(permission: string): PermissionCheck {
    // Check cache
    const cached = this.cache.get(permission);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        permission,
        granted: cached.result,
        reason: 'cached',
        evaluatedAt: cached.expiresAt - this.config.cacheTtlMs,
      };
    }

    const result = this.evaluateUncached(permission);

    // Update cache
    this.cache.set(permission, {
      result: result.granted,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });

    return result;
  }

  /**
   * Check if user has a specific role.
   */
  hasRole(role: string): boolean {
    return this.user?.roles.includes(role) ?? false;
  }

  /**
   * Get all permissions the current user has.
   */
  getGrantedPermissions(): string[] {
    if (!this.user) return [];

    return Object.entries(this.config.policies)
      .filter(([, roles]) => this.userHasAnyRole(roles))
      .map(([permission]) => permission);
  }

  /**
   * Update policies at runtime (e.g., after syncing from server).
   */
  updatePolicies(policies: Record<string, string[]>): void {
    Object.assign(this.config.policies, policies);
    this.cache.clear();
    this.stateSubject.next({
      user: this.user,
      policies: this.config.policies,
      lastEvaluatedAt: Date.now(),
    });
  }

  /**
   * Add a single policy.
   */
  addPolicy(permission: string, roles: string[]): void {
    this.config.policies[permission] = roles;
    this.cache.delete(permission);
  }

  /**
   * Clear the permission cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ── Private ────────────────────────────────────────────

  private evaluateUncached(permission: string): PermissionCheck {
    const now = Date.now();

    // No user → deny
    if (!this.user) {
      return {
        permission,
        granted: false,
        reason: 'No authenticated user',
        evaluatedAt: now,
      };
    }

    // Super-admin bypass
    if (this.user.roles.includes(this.config.superAdminRole)) {
      return {
        permission,
        granted: true,
        reason: `User has super-admin role "${this.config.superAdminRole}"`,
        evaluatedAt: now,
      };
    }

    // Check exact policy match
    const allowedRoles = this.config.policies[permission];
    if (allowedRoles) {
      if (this.userHasAnyRole(allowedRoles)) {
        return {
          permission,
          granted: true,
          reason: `User role matches policy for "${permission}"`,
          evaluatedAt: now,
        };
      }
      return {
        permission,
        granted: false,
        reason: `User roles [${this.user.roles.join(', ')}] don't match required [${allowedRoles.join(', ')}]`,
        evaluatedAt: now,
      };
    }

    // Check wildcard: "resource:*" matches "resource:anything"
    const parts = permission.split(':');
    if (parts.length >= 2) {
      const wildcardKey = `${parts[0]}:*`;
      const wildcardRoles = this.config.policies[wildcardKey];
      if (wildcardRoles && this.userHasAnyRole(wildcardRoles)) {
        return {
          permission,
          granted: true,
          reason: `Matched wildcard policy "${wildcardKey}"`,
          evaluatedAt: now,
        };
      }
    }

    // No policy found
    return {
      permission,
      granted: !this.config.denyByDefault,
      reason: this.config.denyByDefault
        ? `No policy found for "${permission}" (deny by default)`
        : `No policy found for "${permission}" (allow by default)`,
      evaluatedAt: now,
    };
  }

  private userHasAnyRole(roles: string[]): boolean {
    if (!this.user) return false;
    return roles.some((role) => this.user!.roles.includes(role));
  }
}

/**
 * Create an offline RBAC evaluator.
 */
export function createOfflineRBAC(config: RBACConfig): OfflineRBAC {
  return new OfflineRBAC(config);
}
