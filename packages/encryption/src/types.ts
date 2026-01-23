/**
 * Supported encryption algorithms
 */
export type EncryptionAlgorithm = 'AES-GCM' | 'AES-CBC';

/**
 * Key derivation function types
 */
export type KeyDerivationFunction = 'PBKDF2' | 'Argon2';

/**
 * Encryption key configuration
 */
export interface EncryptionKeyConfig {
  /** Key derivation function */
  kdf: KeyDerivationFunction;
  /** Number of iterations for key derivation */
  iterations?: number;
  /** Salt for key derivation (base64 encoded) */
  salt?: string;
  /** Key length in bits */
  keyLength?: number;
}

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  /** Encryption algorithm */
  algorithm: EncryptionAlgorithm;
  /** Key configuration */
  keyConfig: EncryptionKeyConfig;
  /** Fields to encrypt (if not specified, encrypts entire document) */
  encryptedFields?: string[];
  /** Fields to exclude from encryption */
  excludedFields?: string[];
  /** Whether to compress before encrypting */
  compress?: boolean;
}

/**
 * Encrypted data envelope
 */
export interface EncryptedEnvelope {
  /** Encrypted data (base64 encoded) */
  data: string;
  /** Initialization vector (base64 encoded) */
  iv: string;
  /** Authentication tag (for GCM mode) */
  tag?: string;
  /** Algorithm used */
  algorithm: EncryptionAlgorithm;
  /** Version for future compatibility */
  version: number;
  /** Whether data is compressed */
  compressed?: boolean;
}

/**
 * Encrypted document structure
 */
export interface EncryptedDocument {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  _updatedAt?: number;
  /** Encrypted envelope */
  _encrypted: EncryptedEnvelope;
  /** Fields that remain unencrypted */
  _unencrypted?: Record<string, unknown>;
}

/**
 * Encryption key material
 */
export interface EncryptionKey {
  /** Raw key material */
  key: CryptoKey;
  /** Key ID for rotation support */
  keyId: string;
  /** Salt used for derivation */
  salt: Uint8Array;
  /** Algorithm the key is for */
  algorithm: EncryptionAlgorithm;
}

/**
 * Key rotation info
 */
export interface KeyRotationInfo {
  /** Current key ID */
  currentKeyId: string;
  /** Previous key IDs for decryption */
  previousKeyIds: string[];
  /** When the current key was created */
  keyCreatedAt: number;
  /** When the key should be rotated */
  rotateAfter: number;
}

/**
 * Encryption provider interface
 */
export interface EncryptionProvider {
  /** Encrypt data */
  encrypt(data: Uint8Array, key: EncryptionKey): Promise<EncryptedEnvelope>;
  /** Decrypt data */
  decrypt(envelope: EncryptedEnvelope, key: EncryptionKey): Promise<Uint8Array>;
  /** Generate a random IV */
  generateIV(): Uint8Array;
}

/**
 * Key manager interface
 */
export interface KeyManager {
  /** Derive a key from password */
  deriveKey(password: string, config: EncryptionKeyConfig): Promise<EncryptionKey>;
  /** Generate a new random key */
  generateKey(algorithm: EncryptionAlgorithm): Promise<EncryptionKey>;
  /** Export key for storage */
  exportKey(key: EncryptionKey): Promise<string>;
  /** Import key from storage */
  importKey(exported: string, algorithm: EncryptionAlgorithm): Promise<EncryptionKey>;
  /** Get key by ID */
  getKey(keyId: string): EncryptionKey | undefined;
  /** Store a key */
  storeKey(key: EncryptionKey): void;
}

/**
 * Document encryption options
 */
export interface DocumentEncryptionOptions {
  /** Fields to encrypt (overrides config) */
  fields?: string[];
  /** Key to use (uses current key if not specified) */
  keyId?: string;
}

/**
 * Encrypted collection configuration
 */
export interface EncryptedCollectionConfig {
  /** Encryption configuration */
  encryption: EncryptionConfig;
  /** Whether to auto-rotate keys */
  autoKeyRotation?: boolean;
  /** Key rotation interval in milliseconds */
  keyRotationInterval?: number;
}

/**
 * Encryption event types
 */
export type EncryptionEventType =
  | 'key:derived'
  | 'key:rotated'
  | 'document:encrypted'
  | 'document:decrypted'
  | 'error';

/**
 * Encryption event
 */
export interface EncryptionEvent {
  type: EncryptionEventType;
  keyId?: string;
  documentId?: string;
  error?: Error;
  timestamp: number;
}
