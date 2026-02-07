/**
 * Decentralized Identity for @pocket/sync-blockchain.
 *
 * Provides key pair generation, document signing and verification,
 * DID document management, and session key management for convenient
 * temporary authentication.
 *
 * Uses simulated Ed25519 key operations based on Web Crypto API.
 * In production, this would use a proper Ed25519 library.
 *
 * @example
 * ```typescript
 * const identity = createIdentityManager();
 * const keyPair = await identity.generateKeyPair();
 * const did = identity.createDID(keyPair);
 * const signature = await identity.sign(data, keyPair);
 * const valid = await identity.verify(data, signature, keyPair.publicKey);
 * ```
 *
 * @module @pocket/sync-blockchain/identity
 */

import { Subject } from 'rxjs';

import type {
  DIDDocument,
  DIDPublicKey,
  DocumentSignature,
  KeyPair,
  SessionKey,
} from './types.js';

/** Generate a unique identifier. */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Convert a Uint8Array to a hex string.
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate cryptographically random bytes.
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Compute SHA-256 hash and return as hex string.
 */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(hash));
}

/** Default session key lifetime: 24 hours. */
const DEFAULT_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * Manages decentralized identities, key pairs, and document signing.
 *
 * @example
 * ```typescript
 * const manager = createIdentityManager();
 *
 * // Generate identity
 * const keyPair = await manager.generateKeyPair();
 * const did = manager.createDID(keyPair);
 *
 * // Sign and verify
 * const data = new TextEncoder().encode('hello');
 * const sig = await manager.sign(data, keyPair);
 * const valid = await manager.verify(data, sig, keyPair.publicKey);
 * ```
 */
export class IdentityManager {
  private readonly dids = new Map<string, DIDDocument>();
  private readonly sessionKeys = new Map<string, SessionKey>();
  private readonly destroy$ = new Subject<void>();

  /**
   * Generate a new Ed25519-simulated key pair.
   *
   * Uses Web Crypto API for randomness. The key pair is suitable
   * for signing and verification within the sync-blockchain system.
   */
  async generateKeyPair(): Promise<KeyPair> {
    const publicKeyBytes = randomBytes(32);
    const privateKeyBytes = randomBytes(64);

    return {
      publicKey: toHex(publicKeyBytes),
      privateKey: toHex(privateKeyBytes),
      algorithm: 'Ed25519',
      createdAt: Date.now(),
    };
  }

  /**
   * Create a DID document from a key pair.
   *
   * @param keyPair - The key pair to use for the DID.
   * @returns The created DID document.
   */
  createDID(keyPair: KeyPair): DIDDocument {
    const id = `did:pocket:${keyPair.publicKey.slice(0, 16)}`;

    const publicKey: DIDPublicKey = {
      id: `${id}#keys-1`,
      type: 'Ed25519VerificationKey2020',
      controller: id,
      publicKeyHex: keyPair.publicKey,
    };

    const doc: DIDDocument = {
      id,
      publicKeys: [publicKey],
      authentication: [`${id}#keys-1`],
      created: Date.now(),
      updated: Date.now(),
    };

    this.dids.set(id, doc);
    return doc;
  }

  /**
   * Resolve a DID to its document.
   * Returns `null` if the DID is not found.
   */
  resolveDID(did: string): DIDDocument | null {
    return this.dids.get(did) ?? null;
  }

  /**
   * Sign data using a key pair.
   *
   * Produces a deterministic signature by hashing the private key
   * concatenated with the data.
   */
  async sign(data: Uint8Array, keyPair: KeyPair): Promise<DocumentSignature> {
    const privateBytes = new TextEncoder().encode(keyPair.privateKey);
    const combined = new Uint8Array(privateBytes.length + data.length);
    combined.set(privateBytes, 0);
    combined.set(data, privateBytes.length);

    const signature = await sha256Hex(combined);
    const did = `did:pocket:${keyPair.publicKey.slice(0, 16)}`;

    return {
      signer: did,
      signature,
      algorithm: 'Ed25519',
      timestamp: Date.now(),
    };
  }

  /**
   * Verify a document signature.
   *
   * In this simulated implementation, verification succeeds if the
   * signer's DID is known and the signature format is valid.
   */
  async verify(
    _data: Uint8Array,
    signature: DocumentSignature,
    publicKey: string,
  ): Promise<boolean> {
    // Verify the signer's DID matches the public key
    const expectedDid = `did:pocket:${publicKey.slice(0, 16)}`;
    if (signature.signer !== expectedDid) {
      return false;
    }

    // Verify signature format (64 hex chars for SHA-256)
    if (signature.signature.length !== 64) {
      return false;
    }

    // Verify the DID document exists
    const doc = this.dids.get(signature.signer);
    if (!doc) {
      return false;
    }

    // Verify the public key is in the DID document
    const hasKey = doc.publicKeys.some((k) => k.publicKeyHex === publicKey);
    return hasKey;
  }

  /**
   * Create a temporary session key for convenience.
   *
   * Session keys have limited lifetime and are automatically
   * cleaned up when expired.
   *
   * @param did - The DID to create the session key for.
   * @param lifetimeMs - Session key lifetime in milliseconds.
   */
  async createSessionKey(
    did: string,
    lifetimeMs: number = DEFAULT_SESSION_LIFETIME_MS,
  ): Promise<SessionKey> {
    const doc = this.dids.get(did);
    if (!doc) {
      throw new Error(`DID not found: ${did}`);
    }

    const sessionPublicKey = randomBytes(32);
    const sessionPrivateKey = randomBytes(64);

    const sessionKey: SessionKey = {
      id: generateId(),
      did,
      publicKey: toHex(sessionPublicKey),
      privateKey: toHex(sessionPrivateKey),
      expiresAt: Date.now() + lifetimeMs,
      createdAt: Date.now(),
    };

    this.sessionKeys.set(sessionKey.id, sessionKey);
    return sessionKey;
  }

  /**
   * Get a session key by its ID.
   * Returns `null` if the session key is not found or has expired.
   */
  getSessionKey(id: string): SessionKey | null {
    const key = this.sessionKeys.get(id);
    if (!key) return null;

    if (Date.now() > key.expiresAt) {
      this.sessionKeys.delete(id);
      return null;
    }

    return key;
  }

  /**
   * Revoke a session key.
   */
  revokeSessionKey(id: string): boolean {
    return this.sessionKeys.delete(id);
  }

  /**
   * Clean up expired session keys.
   * Returns the number of keys removed.
   */
  cleanExpiredSessionKeys(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, key] of this.sessionKeys) {
      if (now > key.expiresAt) {
        this.sessionKeys.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get all active (non-expired) session keys for a DID.
   */
  getActiveSessionKeys(did: string): SessionKey[] {
    const now = Date.now();
    const keys: SessionKey[] = [];

    for (const key of this.sessionKeys.values()) {
      if (key.did === did && now <= key.expiresAt) {
        keys.push(key);
      }
    }

    return keys;
  }

  /**
   * Get all registered DIDs.
   */
  getAllDIDs(): string[] {
    return Array.from(this.dids.keys());
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.dids.clear();
    this.sessionKeys.clear();
  }
}

/**
 * Create a new IdentityManager instance.
 *
 * @example
 * ```typescript
 * const identity = createIdentityManager();
 * const keyPair = await identity.generateKeyPair();
 * const did = identity.createDID(keyPair);
 * ```
 */
export function createIdentityManager(): IdentityManager {
  return new IdentityManager();
}
