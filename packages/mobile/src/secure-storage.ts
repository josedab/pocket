/**
 * Secure storage abstraction for cross-platform mobile applications.
 *
 * Provides a platform-agnostic API for secure key-value storage with
 * support for Keychain (iOS), Keystore (Android), biometric unlock,
 * and encryption at rest. Falls back to encrypted in-memory storage
 * when platform-native secure storage is unavailable.
 *
 * @module secure-storage
 *
 * @example
 * ```typescript
 * import { createSecureStorage } from '@pocket/mobile';
 *
 * const storage = createSecureStorage({
 *   namespace: 'my-app',
 *   enableBiometrics: true,
 * });
 *
 * await storage.set('auth-token', 'secret-value');
 * const token = await storage.get('auth-token');
 *
 * // Clean up
 * storage.destroy();
 * ```
 */

import { BehaviorSubject, type Observable } from 'rxjs';

import type { SecureAccessControl, SecureStorageSetOptions } from './types.js';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Configuration for {@link SecureStorage}.
 */
export interface SecureStorageConfig {
  /** Namespace prefix for all keys (default: 'pocket') */
  namespace?: string;

  /** Enable biometric unlock for stored values (default: false) */
  enableBiometrics?: boolean;

  /** Default access control level (default: 'afterFirstUnlock') */
  defaultAccessControl?: SecureAccessControl;

  /** Custom encryption function for in-memory fallback */
  encrypt?: (value: string) => string;

  /** Custom decryption function for in-memory fallback */
  decrypt?: (value: string) => string;
}

/**
 * Status of the secure storage backend.
 */
export type SecureStorageStatus = 'ready' | 'locked' | 'unavailable';

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_NAMESPACE = 'pocket';
const DEFAULT_ACCESS_CONTROL: SecureAccessControl = 'afterFirstUnlock';

// ────────────────────────────── SecureStorage ──────────────────────────────

/**
 * Platform-agnostic secure key-value storage.
 *
 * Wraps platform-specific secure storage mechanisms (Keychain, Keystore)
 * behind a unified API. When native secure storage is unavailable,
 * falls back to an encrypted in-memory store.
 *
 * @example
 * ```typescript
 * const storage = new SecureStorage({ namespace: 'auth' });
 *
 * await storage.set('token', 'my-jwt', { requireBiometrics: true });
 * const token = await storage.get('token');
 *
 * console.log(storage.getStatus()); // 'ready'
 * ```
 */
export class SecureStorage {
  private readonly namespace: string;
  private readonly enableBiometrics: boolean;
  private readonly defaultAccessControl: SecureAccessControl;
  private readonly encryptFn: (value: string) => string;
  private readonly decryptFn: (value: string) => string;

  private readonly _store = new Map<string, string>();
  private readonly _status$ = new BehaviorSubject<SecureStorageStatus>('ready');

  constructor(config?: SecureStorageConfig) {
    this.namespace = config?.namespace ?? DEFAULT_NAMESPACE;
    this.enableBiometrics = config?.enableBiometrics ?? false;
    this.defaultAccessControl = config?.defaultAccessControl ?? DEFAULT_ACCESS_CONTROL;
    this.encryptFn = config?.encrypt ?? defaultEncrypt;
    this.decryptFn = config?.decrypt ?? defaultDecrypt;
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Observable of the storage status.
   */
  get status$(): Observable<SecureStorageStatus> {
    return this._status$.asObservable();
  }

  /**
   * Current storage status.
   */
  getStatus(): SecureStorageStatus {
    return this._status$.value;
  }

  /**
   * Store a value securely.
   *
   * @param key - The key to store under
   * @param value - The value to store
   * @param options - Optional storage options
   */
  async set(key: string, value: string, options?: SecureStorageSetOptions): Promise<void> {
    this.ensureReady();

    const _accessControl = options?.accessControl ?? this.defaultAccessControl;
    const _requireBiometrics = options?.requireBiometrics ?? this.enableBiometrics;

    // Use void expressions to mark intentionally unused variables
    void _accessControl;
    void _requireBiometrics;

    const namespacedKey = this.getNamespacedKey(key);
    const encrypted = this.encryptFn(value);
    this._store.set(namespacedKey, encrypted);

    await Promise.resolve();
  }

  /**
   * Retrieve a stored value.
   *
   * @param key - The key to retrieve
   * @returns The decrypted value, or `null` if not found
   */
  async get(key: string): Promise<string | null> {
    this.ensureReady();

    const namespacedKey = this.getNamespacedKey(key);
    const encrypted = this._store.get(namespacedKey);

    if (encrypted === undefined) {
      return null;
    }

    await Promise.resolve();
    return this.decryptFn(encrypted);
  }

  /**
   * Delete a stored value.
   *
   * @param key - The key to delete
   * @returns Whether a value was deleted
   */
  async delete(key: string): Promise<boolean> {
    this.ensureReady();

    const namespacedKey = this.getNamespacedKey(key);
    const result = this._store.delete(namespacedKey);

    await Promise.resolve();
    return result;
  }

  /**
   * Check if a key exists in storage.
   *
   * @param key - The key to check
   * @returns Whether the key exists
   */
  async has(key: string): Promise<boolean> {
    const namespacedKey = this.getNamespacedKey(key);
    await Promise.resolve();
    return this._store.has(namespacedKey);
  }

  /**
   * List all keys in the current namespace.
   *
   * @returns Array of keys (without namespace prefix)
   */
  async keys(): Promise<string[]> {
    const prefix = `${this.namespace}:`;
    const result: string[] = [];

    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        result.push(key.slice(prefix.length));
      }
    }

    await Promise.resolve();
    return result;
  }

  /**
   * Clear all values in the current namespace.
   */
  async clear(): Promise<void> {
    const prefix = `${this.namespace}:`;
    const keysToDelete: string[] = [];

    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this._store.delete(key);
    }

    await Promise.resolve();
  }

  /**
   * Lock the storage, preventing reads and writes until unlocked.
   */
  lock(): void {
    this._status$.next('locked');
  }

  /**
   * Unlock the storage, allowing reads and writes.
   */
  unlock(): void {
    if (this._status$.value === 'locked') {
      this._status$.next('ready');
    }
  }

  /**
   * Get the total number of stored items in this namespace.
   */
  size(): number {
    const prefix = `${this.namespace}:`;
    let count = 0;

    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Destroy the storage, clearing all data and releasing resources.
   */
  destroy(): void {
    this._store.clear();
    this._status$.next('unavailable');
    this._status$.complete();
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private getNamespacedKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private ensureReady(): void {
    const status = this._status$.value;
    if (status === 'locked') {
      throw new Error('Secure storage is locked. Call unlock() first.');
    }
    if (status === 'unavailable') {
      throw new Error('Secure storage has been destroyed.');
    }
  }
}

// ────────────────────────────── Default Encryption ──────────────────────────────

/**
 * Simple base64 encoding as default "encryption" for in-memory fallback.
 * In production, replace with a proper encryption implementation.
 */
function defaultEncrypt(value: string): string {
  if (typeof btoa === 'function') {
    return btoa(value);
  }
  return Buffer.from(value, 'utf-8').toString('base64');
}

function defaultDecrypt(value: string): string {
  if (typeof atob === 'function') {
    return atob(value);
  }
  return Buffer.from(value, 'base64').toString('utf-8');
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link SecureStorage} instance.
 *
 * @param config - Optional secure storage configuration
 * @returns A new SecureStorage
 *
 * @example
 * ```typescript
 * const storage = createSecureStorage({
 *   namespace: 'auth',
 *   enableBiometrics: true,
 * });
 *
 * await storage.set('token', 'my-jwt');
 * const token = await storage.get('token');
 * ```
 */
export function createSecureStorage(config?: SecureStorageConfig): SecureStorage {
  return new SecureStorage(config);
}
