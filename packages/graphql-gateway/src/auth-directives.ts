/**
 * @module auth-directives
 *
 * Auth directive system for the GraphQL gateway.
 * Provides @auth, @roles, and @rateLimit directive handling with JWT
 * validation and middleware chaining.
 *
 * @example
 * ```typescript
 * import { createAuthDirectiveHandler } from '@pocket/graphql-gateway';
 *
 * const handler = createAuthDirectiveHandler({
 *   jwtSecret: 'my-secret',
 *   rateLimitWindow: 60_000,
 * });
 *
 * // Validate a JWT token and extract user context
 * const user = handler.validateToken('eyJhbGciOi...');
 *
 * // Check role-based access
 * handler.checkRoles(user, ['admin', 'editor']);
 *
 * // Build a middleware chain for a field
 * const chain = handler.buildMiddlewareChain([
 *   { directive: 'auth' },
 *   { directive: 'roles', args: { roles: ['admin'] } },
 *   { directive: 'rateLimit', args: { max: 100, window: 60000 } },
 * ]);
 * ```
 */

/** Supported user role names. */
export type UserRole = 'admin' | 'editor' | 'viewer';

/** Decoded user context extracted from a JWT token. */
export interface UserContext {
  userId: string;
  roles: UserRole[];
  /** Token issued-at timestamp (epoch ms). */
  issuedAt: number;
  /** Token expiry timestamp (epoch ms). */
  expiresAt: number;
}

/** Supported directive names. */
export type DirectiveName = 'auth' | 'roles' | 'rateLimit';

/** A directive applied to a field. */
export interface FieldDirective {
  directive: DirectiveName;
  args?: Record<string, unknown>;
}

/** Configuration for the auth directive handler. */
export interface AuthDirectiveConfig {
  /** Secret used to validate JWT tokens. */
  jwtSecret: string;
  /** Default rate-limit window in milliseconds (default: 60 000). */
  rateLimitWindow?: number;
  /** Default rate-limit maximum requests per window (default: 100). */
  rateLimitMax?: number;
}

/** A single rate-limit tracking entry. */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/** Result of executing a middleware chain. */
export interface MiddlewareResult {
  allowed: boolean;
  user?: UserContext;
  error?: string;
}

/** A middleware function in the directive chain. */
export type DirectiveMiddleware = (
  context: MiddlewareContext,
) => MiddlewareResult;

/** Context threaded through the middleware chain. */
export interface MiddlewareContext {
  token?: string;
  fieldName: string;
  user?: UserContext;
}

const DEFAULT_RATE_LIMIT_WINDOW = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 100;

/**
 * Handles @auth, @roles, and @rateLimit directives for the GraphQL gateway.
 */
export class AuthDirectiveHandler {
  private readonly config: Required<AuthDirectiveConfig>;
  private readonly rateLimitStore = new Map<string, RateLimitEntry>();

  constructor(config: AuthDirectiveConfig) {
    this.config = {
      jwtSecret: config.jwtSecret,
      rateLimitWindow: config.rateLimitWindow ?? DEFAULT_RATE_LIMIT_WINDOW,
      rateLimitMax: config.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX,
    };
  }

  /**
   * Validate a JWT token and return the decoded user context.
   *
   * Uses a simplified base64-JSON approach for portability (no external
   * JWT library dependency). Real deployments should swap in `jsonwebtoken`
   * or a similar library.
   */
  validateToken(token: string): UserContext {
    if (!token) {
      throw new Error('Auth directive: token is required');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Auth directive: invalid token format — expected three dot-separated segments');
    }

    try {
      const payload = JSON.parse(
        Buffer.from(parts[1]!, 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;

      const now = Date.now();
      const expiresAt =
        typeof payload['exp'] === 'number' ? payload['exp'] * 1000 : now + 3_600_000;

      if (expiresAt < now) {
        throw new Error('Auth directive: token has expired');
      }

      return {
        userId: String(payload['sub'] ?? payload['userId'] ?? ''),
        roles: (Array.isArray(payload['roles']) ? payload['roles'] : ['viewer']) as UserRole[],
        issuedAt:
          typeof payload['iat'] === 'number' ? payload['iat'] * 1000 : now,
        expiresAt,
      };
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Auth directive:')) {
        throw err;
      }
      throw new Error('Auth directive: failed to decode token payload');
    }
  }

  /**
   * Assert that the user holds at least one of the required roles.
   * Throws if the check fails.
   */
  checkRoles(user: UserContext, requiredRoles: UserRole[]): void {
    if (requiredRoles.length === 0) return;

    const hasRole = user.roles.some((r) => requiredRoles.includes(r));
    if (!hasRole) {
      throw new Error(
        `Roles directive: user does not have any of the required roles [${requiredRoles.join(', ')}]`,
      );
    }
  }

  /**
   * Check and increment the rate-limit counter for a given key.
   * Returns `true` if the request is allowed, `false` if the limit is exceeded.
   */
  checkRateLimit(
    key: string,
    max?: number,
    windowMs?: number,
  ): boolean {
    const limit = max ?? this.config.rateLimitMax;
    const window = windowMs ?? this.config.rateLimitWindow;
    const now = Date.now();

    const entry = this.rateLimitStore.get(key);

    if (!entry || now - entry.windowStart >= window) {
      this.rateLimitStore.set(key, { count: 1, windowStart: now });
      return true;
    }

    entry.count++;
    if (entry.count > limit) {
      return false;
    }

    return true;
  }

  /** Clear all stored rate-limit counters. */
  clearRateLimits(): void {
    this.rateLimitStore.clear();
  }

  /**
   * Build an ordered middleware chain from a list of field directives.
   * Executing the returned function will run each directive's logic in order.
   */
  buildMiddlewareChain(
    directives: FieldDirective[],
  ): (context: MiddlewareContext) => MiddlewareResult {
    const middlewares = directives.map((d) => this.createMiddleware(d));

    return (context: MiddlewareContext): MiddlewareResult => {
      let currentUser = context.user;

      for (const mw of middlewares) {
        const result = mw({ ...context, user: currentUser });
        if (!result.allowed) {
          return result;
        }
        if (result.user) {
          currentUser = result.user;
        }
      }

      return { allowed: true, user: currentUser };
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  private createMiddleware(directive: FieldDirective): DirectiveMiddleware {
    switch (directive.directive) {
      case 'auth':
        return (ctx) => this.authMiddleware(ctx);
      case 'roles':
        return (ctx) => this.rolesMiddleware(ctx, directive.args);
      case 'rateLimit':
        return (ctx) => this.rateLimitMiddleware(ctx, directive.args);
    }
  }

  private authMiddleware(context: MiddlewareContext): MiddlewareResult {
    try {
      const user = this.validateToken(context.token ?? '');
      return { allowed: true, user };
    } catch (err) {
      return {
        allowed: false,
        error: err instanceof Error ? err.message : 'Authentication failed',
      };
    }
  }

  private rolesMiddleware(
    context: MiddlewareContext,
    args?: Record<string, unknown>,
  ): MiddlewareResult {
    if (!context.user) {
      return { allowed: false, error: 'Roles directive: user context is required — add @auth first' };
    }

    const requiredRoles = (
      Array.isArray(args?.['roles']) ? args['roles'] : []
    ) as UserRole[];

    try {
      this.checkRoles(context.user, requiredRoles);
      return { allowed: true, user: context.user };
    } catch (err) {
      return {
        allowed: false,
        error: err instanceof Error ? err.message : 'Role check failed',
      };
    }
  }

  private rateLimitMiddleware(
    context: MiddlewareContext,
    args?: Record<string, unknown>,
  ): MiddlewareResult {
    const max =
      typeof args?.['max'] === 'number' ? args['max'] : undefined;
    const windowMs =
      typeof args?.['window'] === 'number' ? args['window'] : undefined;
    const key = `${context.user?.userId ?? 'anon'}:${context.fieldName}`;

    if (!this.checkRateLimit(key, max, windowMs)) {
      return {
        allowed: false,
        error: `RateLimit directive: limit exceeded for field "${context.fieldName}"`,
      };
    }

    return { allowed: true, user: context.user };
  }
}

/** Factory function to create an {@link AuthDirectiveHandler}. */
export function createAuthDirectiveHandler(
  config: AuthDirectiveConfig,
): AuthDirectiveHandler {
  return new AuthDirectiveHandler(config);
}
