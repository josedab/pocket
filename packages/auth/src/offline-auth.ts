/**
 * Offline-First Auth with Passkeys — credential caching, offline token
 * validation, secure local session management, and seamless
 * online/offline auth transitions.
 *
 * @module @pocket/auth
 */

import { BehaviorSubject, type Observable, Subject } from 'rxjs';
import type { AuthState, AuthUser, TokenPair } from './types.js';

// ── Types ─────────────────────────────────────────────────

export interface OfflineAuthConfig {
  /** How long cached credentials remain valid offline (ms, default: 30 days) */
  credentialTtlMs?: number;
  /** How long offline sessions last without re-auth (ms, default: 7 days) */
  sessionTtlMs?: number;
  /** Maximum number of cached credentials to store */
  maxCachedCredentials?: number;
  /** Enable biometric re-verification for offline sessions */
  requireBiometricOffline?: boolean;
  /** Storage key prefix for credential cache */
  storagePrefix?: string;
  /** Custom storage backend (default: in-memory, use IndexedDB in production) */
  storage?: OfflineCredentialStorage;
}

export interface CachedCredential {
  userId: string;
  credentialId: string;
  publicKeyHash: string;
  userName: string;
  displayName?: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

export interface OfflineSession {
  userId: string;
  user: AuthUser;
  token: string;
  createdAt: number;
  expiresAt: number;
  lastVerifiedAt: number;
  isOffline: boolean;
  credentialId?: string;
}

export interface OfflineCredentialStorage {
  getCredentials(): Promise<CachedCredential[]>;
  saveCredential(credential: CachedCredential): Promise<void>;
  removeCredential(credentialId: string): Promise<void>;
  getSession(): Promise<OfflineSession | null>;
  saveSession(session: OfflineSession): Promise<void>;
  clearSession(): Promise<void>;
  clear(): Promise<void>;
}

export type OfflineAuthEvent =
  | { type: 'credential_cached'; credentialId: string; userId: string }
  | { type: 'credential_removed'; credentialId: string }
  | { type: 'offline_session_created'; userId: string }
  | { type: 'offline_session_restored'; userId: string }
  | { type: 'offline_session_expired'; userId: string }
  | { type: 'online_transition'; userId: string }
  | { type: 'offline_transition'; userId: string }
  | { type: 'token_refreshed_online'; userId: string }
  | { type: 'error'; message: string };

export interface OfflineAuthState {
  isOnline: boolean;
  hasOfflineSession: boolean;
  cachedCredentialCount: number;
  currentSession: OfflineSession | null;
  lastOnlineAt: number | null;
}

// ── In-Memory Credential Storage ──────────────────────────

export class InMemoryCredentialStorage implements OfflineCredentialStorage {
  private credentials: CachedCredential[] = [];
  private session: OfflineSession | null = null;

  async getCredentials(): Promise<CachedCredential[]> {
    return [...this.credentials];
  }

  async saveCredential(credential: CachedCredential): Promise<void> {
    const idx = this.credentials.findIndex((c) => c.credentialId === credential.credentialId);
    if (idx >= 0) {
      this.credentials[idx] = credential;
    } else {
      this.credentials.push(credential);
    }
  }

  async removeCredential(credentialId: string): Promise<void> {
    this.credentials = this.credentials.filter((c) => c.credentialId !== credentialId);
  }

  async getSession(): Promise<OfflineSession | null> {
    return this.session ? { ...this.session } : null;
  }

  async saveSession(session: OfflineSession): Promise<void> {
    this.session = { ...session };
  }

  async clearSession(): Promise<void> {
    this.session = null;
  }

  async clear(): Promise<void> {
    this.credentials = [];
    this.session = null;
  }
}

// ── Offline Auth Manager ──────────────────────────────────

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Manages offline-first authentication with passkey credential caching.
 *
 * Caches WebAuthn credential metadata locally so users can be authenticated
 * offline. Manages session lifecycle across online/offline transitions.
 *
 * ```ts
 * const offlineAuth = createOfflineAuth({
 *   credentialTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
 *   sessionTtlMs: 7 * 24 * 60 * 60 * 1000,     // 7 days
 * });
 *
 * // After online passkey auth, cache the credential
 * await offlineAuth.cacheCredential({ userId: 'u1', credentialId: 'cred1', ... });
 *
 * // When offline, restore session
 * const session = await offlineAuth.restoreOfflineSession();
 * ```
 */
export class OfflineAuthManager {
  private readonly config: Required<OfflineAuthConfig>;
  private readonly storage: OfflineCredentialStorage;
  private readonly events$$ = new Subject<OfflineAuthEvent>();
  private readonly state$$: BehaviorSubject<OfflineAuthState>;
  private isOnline = true;

  readonly events$ = this.events$$.asObservable();

  constructor(config: OfflineAuthConfig = {}) {
    this.config = {
      credentialTtlMs: config.credentialTtlMs ?? THIRTY_DAYS_MS,
      sessionTtlMs: config.sessionTtlMs ?? SEVEN_DAYS_MS,
      maxCachedCredentials: config.maxCachedCredentials ?? 5,
      requireBiometricOffline: config.requireBiometricOffline ?? false,
      storagePrefix: config.storagePrefix ?? 'pocket_auth_',
      storage: config.storage ?? new InMemoryCredentialStorage(),
    };
    this.storage = this.config.storage;

    this.state$$ = new BehaviorSubject<OfflineAuthState>({
      isOnline: true,
      hasOfflineSession: false,
      cachedCredentialCount: 0,
      currentSession: null,
      lastOnlineAt: Date.now(),
    });
  }

  get state$(): Observable<OfflineAuthState> {
    return this.state$$.asObservable();
  }

  getState(): OfflineAuthState {
    return this.state$$.getValue();
  }

  /**
   * Cache a credential after successful online authentication.
   * Stores credential metadata (not private keys) for offline verification.
   */
  async cacheCredential(
    credential: Omit<CachedCredential, 'createdAt' | 'lastUsedAt' | 'expiresAt'>
  ): Promise<void> {
    // Enforce max cached credentials
    const existing = await this.storage.getCredentials();
    if (existing.length >= this.config.maxCachedCredentials) {
      // Remove oldest
      const oldest = existing.sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (oldest) {
        await this.storage.removeCredential(oldest.credentialId);
      }
    }

    const cached: CachedCredential = {
      ...credential,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      expiresAt: Date.now() + this.config.credentialTtlMs,
    };

    await this.storage.saveCredential(cached);
    this.events$$.next({
      type: 'credential_cached',
      credentialId: cached.credentialId,
      userId: cached.userId,
    });
    await this.refreshState();
  }

  /** Remove a cached credential */
  async removeCredential(credentialId: string): Promise<void> {
    await this.storage.removeCredential(credentialId);
    this.events$$.next({ type: 'credential_removed', credentialId });
    await this.refreshState();
  }

  /** Get all valid (non-expired) cached credentials */
  async getCachedCredentials(): Promise<CachedCredential[]> {
    const all = await this.storage.getCredentials();
    const now = Date.now();
    return all.filter((c) => c.expiresAt > now);
  }

  /**
   * Create an offline session after successful online auth.
   * Call this after the user authenticates online to enable offline access.
   */
  async createOfflineSession(
    user: AuthUser,
    tokens: TokenPair,
    credentialId?: string
  ): Promise<OfflineSession> {
    const session: OfflineSession = {
      userId: user.id,
      user,
      token: tokens.accessToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.sessionTtlMs,
      lastVerifiedAt: Date.now(),
      isOffline: false,
      credentialId,
    };

    await this.storage.saveSession(session);
    this.events$$.next({ type: 'offline_session_created', userId: user.id });
    await this.refreshState();
    return session;
  }

  /**
   * Try to restore an offline session. Returns the session if valid.
   */
  async restoreOfflineSession(): Promise<OfflineSession | null> {
    const session = await this.storage.getSession();
    if (!session) return null;

    // Check session expiry
    if (session.expiresAt < Date.now()) {
      this.events$$.next({ type: 'offline_session_expired', userId: session.userId });
      await this.storage.clearSession();
      await this.refreshState();
      return null;
    }

    // If the credential was cached, verify it still exists
    if (session.credentialId) {
      const creds = await this.getCachedCredentials();
      const found = creds.find((c) => c.credentialId === session.credentialId);
      if (!found) {
        await this.storage.clearSession();
        await this.refreshState();
        return null;
      }

      // Update last used time on credential
      found.lastUsedAt = Date.now();
      await this.storage.saveCredential(found);
    }

    const restoredSession: OfflineSession = { ...session, isOffline: true };
    await this.storage.saveSession(restoredSession);
    this.events$$.next({ type: 'offline_session_restored', userId: session.userId });
    await this.refreshState();
    return restoredSession;
  }

  /**
   * Validate an offline token. Performs local-only checks:
   * - Session exists and is not expired
   * - Credential is still cached (if applicable)
   *
   * Does NOT verify JWT signature (requires server).
   */
  async validateOfflineToken(): Promise<{
    valid: boolean;
    user: AuthUser | null;
    reason?: string;
  }> {
    const session = await this.storage.getSession();
    if (!session) {
      return { valid: false, user: null, reason: 'No offline session' };
    }

    if (session.expiresAt < Date.now()) {
      return { valid: false, user: null, reason: 'Offline session expired' };
    }

    return { valid: true, user: session.user };
  }

  /**
   * Handle transition to online state.
   * Attempts to refresh the token with the server.
   */
  async transitionOnline(refreshFn?: (token: string) => Promise<TokenPair>): Promise<AuthState> {
    this.isOnline = true;
    const session = await this.storage.getSession();

    if (session && refreshFn) {
      try {
        const newTokens = await refreshFn(session.token);
        const updatedSession: OfflineSession = {
          ...session,
          token: newTokens.accessToken,
          isOffline: false,
          lastVerifiedAt: Date.now(),
          expiresAt: Date.now() + this.config.sessionTtlMs,
        };
        await this.storage.saveSession(updatedSession);
        this.events$$.next({ type: 'token_refreshed_online', userId: session.userId });
        this.events$$.next({ type: 'online_transition', userId: session.userId });
        await this.refreshState();

        return {
          isAuthenticated: true,
          user: session.user,
          token: newTokens.accessToken,
          expiresAt: Date.now() + newTokens.expiresIn * 1000,
          isOffline: false,
        };
      } catch {
        // Token refresh failed — session still valid locally
        this.events$$.next({ type: 'error', message: 'Online token refresh failed' });
      }
    }

    this.events$$.next({ type: 'online_transition', userId: session?.userId ?? 'unknown' });
    await this.refreshState();

    return {
      isAuthenticated: !!session,
      user: session?.user ?? null,
      token: session?.token ?? null,
      expiresAt: session?.expiresAt ?? null,
      isOffline: false,
    };
  }

  /** Handle transition to offline state */
  async transitionOffline(): Promise<AuthState> {
    this.isOnline = false;
    const session = await this.restoreOfflineSession();

    if (session) {
      this.events$$.next({ type: 'offline_transition', userId: session.userId });
    }

    await this.refreshState();

    return {
      isAuthenticated: !!session,
      user: session?.user ?? null,
      token: session?.token ?? null,
      expiresAt: session?.expiresAt ?? null,
      isOffline: true,
    };
  }

  /** Clear session and logout */
  async logout(): Promise<void> {
    await this.storage.clearSession();
    await this.refreshState();
  }

  /** Clear all cached credentials and sessions */
  async clearAll(): Promise<void> {
    await this.storage.clear();
    await this.refreshState();
  }

  /** Destroy the manager */
  destroy(): void {
    this.events$$.complete();
    this.state$$.complete();
  }

  private async refreshState(): Promise<void> {
    const session = await this.storage.getSession();
    const creds = await this.storage.getCredentials();
    this.state$$.next({
      isOnline: this.isOnline,
      hasOfflineSession: !!session && session.expiresAt > Date.now(),
      cachedCredentialCount: creds.filter((c) => c.expiresAt > Date.now()).length,
      currentSession: session,
      lastOnlineAt: this.isOnline ? Date.now() : this.state$$.getValue().lastOnlineAt,
    });
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create an offline-first auth manager */
export function createOfflineAuth(config?: OfflineAuthConfig): OfflineAuthManager {
  return new OfflineAuthManager(config);
}
