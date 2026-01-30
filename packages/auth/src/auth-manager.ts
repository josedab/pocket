/**
 * Auth Manager - Central authentication orchestrator
 *
 * Manages the full auth lifecycle including login, logout, token refresh,
 * offline grace period, and state observation. Integrates with auth providers
 * and the token manager.
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import { TokenManager } from './token-manager.js';
import type {
  AuthConfig,
  AuthEvent,
  AuthProvider,
  AuthState,
  AuthUser,
} from './types.js';

/**
 * Default offline grace period: 7 days
 */
const DEFAULT_OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Central authentication manager for the Pocket database.
 *
 * Coordinates authentication providers, manages token lifecycle,
 * handles offline scenarios, and exposes reactive state observables.
 *
 * Key features:
 * - Multiple provider support (OAuth2, passkeys, credentials)
 * - Automatic token refresh before expiry
 * - Offline grace period: expired tokens remain valid while offline
 * - Reactive auth state via RxJS observables
 * - Event stream for auth lifecycle events
 *
 * @example
 * ```typescript
 * const auth = createAuthManager({
 *   tokenRefreshThresholdMs: 5 * 60 * 1000,
 *   offlineGracePeriodMs: 7 * 24 * 60 * 60 * 1000,
 * });
 *
 * auth.registerProvider(credentialsProvider);
 * auth.registerProvider(oauth2Provider);
 *
 * // Login
 * const state = await auth.login('credentials', {
 *   email: 'user@example.com',
 *   password: 'password',
 * });
 *
 * // Observe state changes
 * auth.onAuthStateChange().subscribe((state) => {
 *   console.log('Auth state:', state.isAuthenticated);
 * });
 *
 * // Logout
 * await auth.logout();
 * ```
 */
export class AuthManager {
  private readonly providers = new Map<string, AuthProvider>();
  private readonly tokenManager: TokenManager;
  private readonly config: Required<
    Pick<AuthConfig, 'offlineGracePeriodMs' | 'tokenRefreshThresholdMs'>
  > & AuthConfig;

  private readonly state$: BehaviorSubject<AuthState>;
  private readonly events$ = new Subject<AuthEvent>();

  private isDisposed = false;

  constructor(config: AuthConfig = {}) {
    this.config = {
      ...config,
      tokenRefreshThresholdMs: config.tokenRefreshThresholdMs ?? 5 * 60 * 1000,
      offlineGracePeriodMs: config.offlineGracePeriodMs ?? DEFAULT_OFFLINE_GRACE_PERIOD_MS,
    };

    this.tokenManager = new TokenManager({
      tokenRefreshThresholdMs: this.config.tokenRefreshThresholdMs,
    });

    this.state$ = new BehaviorSubject<AuthState>({
      isAuthenticated: false,
      user: null,
      token: null,
      expiresAt: null,
      isOffline: false,
    });
  }

  /**
   * Register an authentication provider.
   *
   * Providers are identified by their name property. Only one provider
   * per name can be registered at a time.
   *
   * @param provider - The auth provider to register
   * @throws Error if a provider with the same name is already registered
   */
  registerProvider(provider: AuthProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(`Auth provider "${provider.name}" is already registered`);
    }
    this.providers.set(provider.name, provider);
  }

  /**
   * Authenticate using a named provider.
   *
   * Delegates to the provider's authenticate method, stores the resulting
   * tokens, extracts user information, schedules token refresh, and
   * updates the auth state.
   *
   * @param providerName - Name of the registered provider to use
   * @param params - Provider-specific authentication parameters
   * @returns The new auth state after login
   * @throws Error if the provider is not registered or authentication fails
   */
  async login(providerName: string, params?: unknown): Promise<AuthState> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Auth provider "${providerName}" is not registered`);
    }

    try {
      const tokens = await provider.authenticate(params);

      // Store tokens
      this.tokenManager.storeTokens(tokens);

      // Decode user from token
      const payload = this.tokenManager.decodeToken(tokens.accessToken);
      const user: AuthUser = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        roles: payload.roles ?? [],
      };

      const expiresAt = payload.exp * 1000;

      // Update state
      const newState: AuthState = {
        isAuthenticated: true,
        user,
        token: tokens.accessToken,
        expiresAt,
        isOffline: false,
      };

      this.updateState(newState);
      this.emitEvent({ type: 'auth:login', user });

      // Schedule auto-refresh
      this.scheduleTokenRefresh(providerName);

      return newState;
    } catch (error) {
      const authError =
        error instanceof Error ? error : new Error(String(error));
      this.emitEvent({ type: 'auth:error', error: authError });
      throw authError;
    }
  }

  /**
   * Log out the current user.
   *
   * Attempts to revoke the current token via the provider (best-effort),
   * clears all stored tokens, and resets the auth state.
   */
  async logout(): Promise<void> {
    const currentToken = this.tokenManager.getAccessToken();

    // Try to revoke the token with each provider that supports it
    if (currentToken) {
      for (const provider of this.providers.values()) {
        if (provider.revoke) {
          try {
            await provider.revoke(currentToken);
          } catch {
            // Revocation is best-effort
          }
        }
      }
    }

    // Clear tokens and state
    this.tokenManager.clearTokens();

    const newState: AuthState = {
      isAuthenticated: false,
      user: null,
      token: null,
      expiresAt: null,
      isOffline: false,
    };

    this.updateState(newState);
    this.emitEvent({ type: 'auth:logout' });
  }

  /**
   * Get the current authentication state.
   *
   * If the user was previously authenticated and the token is expired,
   * checks offline status and applies the offline grace period.
   *
   * @returns The current AuthState
   */
  getState(): AuthState {
    const state = this.state$.getValue();

    // Check if we need to apply offline grace period
    if (state.isAuthenticated && state.token) {
      const isExpired = this.tokenManager.isTokenExpired(state.token);

      if (isExpired) {
        const isOffline = this.checkIsOffline();

        if (isOffline && state.expiresAt) {
          const gracePeriodEnd = state.expiresAt + this.config.offlineGracePeriodMs;
          const withinGracePeriod = Date.now() < gracePeriodEnd;

          if (withinGracePeriod) {
            // Allow expired token during offline grace period
            const offlineState: AuthState = {
              ...state,
              isOffline: true,
            };

            if (!state.isOffline && state.user) {
              this.emitEvent({ type: 'auth:offline-mode', user: state.user });
            }

            return offlineState;
          }
        }

        // Token expired and not within grace period
        this.emitEvent({ type: 'auth:token-expired' });

        const expiredState: AuthState = {
          isAuthenticated: false,
          user: null,
          token: null,
          expiresAt: null,
          isOffline: isOffline,
        };

        this.updateState(expiredState);
        return expiredState;
      }
    }

    return state;
  }

  /**
   * Get the current authenticated user, or null.
   */
  getUser(): AuthUser | null {
    return this.getState().user;
  }

  /**
   * Get the current access token, or null.
   */
  getToken(): string | null {
    return this.tokenManager.getAccessToken();
  }

  /**
   * Check if the user is currently authenticated.
   *
   * Takes into account token expiry and offline grace period.
   */
  isAuthenticated(): boolean {
    return this.getState().isAuthenticated;
  }

  /**
   * Subscribe to auth state changes.
   *
   * Returns an RxJS Observable that emits the current state immediately
   * and then emits on every state change.
   *
   * @returns Observable<AuthState>
   */
  onAuthStateChange(): Observable<AuthState> {
    return this.state$.asObservable();
  }

  /**
   * Subscribe to auth events.
   *
   * Events include login, logout, token refresh, token expiry,
   * errors, and offline mode transitions.
   *
   * @returns Observable<AuthEvent>
   */
  events(): Observable<AuthEvent> {
    return this.events$.asObservable();
  }

  /**
   * Get the internal token manager.
   *
   * Useful for advanced token operations like manual decode or
   * checking expiry.
   */
  getTokenManager(): TokenManager {
    return this.tokenManager;
  }

  /**
   * Clean up resources: cancel timers, complete observables.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.tokenManager.dispose();
    this.state$.complete();
    this.events$.complete();
  }

  /**
   * Schedule automatic token refresh before expiry.
   *
   * @param providerName - The provider to use for refreshing
   */
  private scheduleTokenRefresh(providerName: string): void {
    this.tokenManager.scheduleRefresh(async () => {
      await this.refreshToken(providerName);
    });
  }

  /**
   * Perform a token refresh using the named provider.
   *
   * @param providerName - The provider name to refresh with
   */
  private async refreshToken(providerName: string): Promise<void> {
    const provider = this.providers.get(providerName);
    const currentRefreshToken = this.tokenManager.getRefreshToken();

    if (!provider?.refresh || !currentRefreshToken) {
      return;
    }

    try {
      const tokens = await provider.refresh(currentRefreshToken);
      this.tokenManager.storeTokens(tokens);

      const payload = this.tokenManager.decodeToken(tokens.accessToken);
      const user: AuthUser = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        roles: payload.roles ?? [],
      };

      const expiresAt = payload.exp * 1000;

      const newState: AuthState = {
        isAuthenticated: true,
        user,
        token: tokens.accessToken,
        expiresAt,
        isOffline: false,
      };

      this.updateState(newState);
      this.emitEvent({ type: 'auth:token-refreshed', expiresAt });

      // Schedule next refresh
      this.scheduleTokenRefresh(providerName);
    } catch (error) {
      const authError =
        error instanceof Error ? error : new Error(String(error));
      this.emitEvent({ type: 'auth:error', error: authError });
    }
  }

  /**
   * Update the auth state and notify subscribers.
   */
  private updateState(state: AuthState): void {
    this.state$.next(state);

    if (this.config.onAuthStateChange) {
      this.config.onAuthStateChange(state);
    }
  }

  /**
   * Emit an auth event to subscribers.
   */
  private emitEvent(event: AuthEvent): void {
    this.events$.next(event);
  }

  /**
   * Check if the client is currently offline.
   *
   * Uses navigator.onLine when available (browser), defaults to false (online)
   * in environments without navigator (Node.js).
   */
  private checkIsOffline(): boolean {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return !navigator.onLine;
    }
    // Default to online in non-browser environments
    return false;
  }
}

/**
 * Create a new AuthManager instance.
 *
 * @param config - Optional auth configuration
 * @returns A new AuthManager
 */
export function createAuthManager(config?: AuthConfig): AuthManager {
  return new AuthManager(config);
}
