/**
 * KeyBackup - Key backup and recovery system for Pocket.
 *
 * Provides secure backup and recovery of encryption keys using
 * passphrase-based encryption (PBKDF2 + AES-GCM). Supports both
 * encrypted JSON and mnemonic-based recovery phrases.
 *
 * @module @pocket/encryption
 *
 * @example
 * ```typescript
 * import { createKeyBackup } from '@pocket/encryption';
 *
 * const backup = createKeyBackup();
 * const masterKey = crypto.getRandomValues(new Uint8Array(32));
 * const encrypted = await backup.createBackup(masterKey, 'my-secure-passphrase');
 * const restored = await backup.restoreFromBackup({ backup: encrypted, passphrase: 'my-secure-passphrase' });
 * ```
 *
 * @see {@link KeyExchangeManager} for device pairing and key exchange
 */

import { fromBase64, getSubtleCrypto, randomBytes, toBase64 } from './crypto-utils.js';

/** Word list for recovery phrase generation (256 common English words) */
const RECOVERY_WORD_LIST: string[] = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'across', 'act', 'action', 'actor', 'actual', 'adapt', 'add', 'addict',
  'address', 'adjust', 'admit', 'adult', 'advance', 'advice', 'afford', 'afraid',
  'again', 'age', 'agent', 'agree', 'ahead', 'aim', 'air', 'airport',
  'aisle', 'alarm', 'album', 'alert', 'alien', 'all', 'alley', 'allow',
  'almost', 'alone', 'alpha', 'already', 'also', 'alter', 'always', 'amateur',
  'amazing', 'among', 'amount', 'amused', 'anchor', 'ancient', 'anger', 'angle',
  'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'apart',
  'apple', 'april', 'arch', 'arctic', 'area', 'arena', 'argue', 'armed',
  'armor', 'army', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artist',
  'atom', 'august', 'aunt', 'auto', 'avocado', 'avoid', 'awake', 'aware',
  'balance', 'ball', 'bamboo', 'banana', 'banner', 'barely', 'bargain', 'barrel',
  'base', 'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'become',
  'before', 'begin', 'behave', 'believe', 'below', 'bench', 'benefit', 'best',
  'betray', 'better', 'between', 'beyond', 'bicycle', 'bid', 'bike', 'bind',
  'bird', 'birth', 'bitter', 'black', 'blade', 'blame', 'blanket', 'blast',
  'bleak', 'bless', 'blind', 'blood', 'blossom', 'blue', 'blur', 'blush',
  'board', 'boat', 'body', 'boil', 'bomb', 'bone', 'bonus', 'book',
  'border', 'boring', 'borrow', 'boss', 'bottom', 'bounce', 'box', 'boy',
  'brain', 'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge',
  'brief', 'bright', 'bring', 'broken', 'bronze', 'broom', 'brother', 'brown',
  'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bullet', 'bundle',
  'burden', 'burger', 'burst', 'bus', 'busy', 'butter', 'buyer', 'cabin',
  'cable', 'cage', 'cake', 'call', 'calm', 'camera', 'camp', 'canal',
  'candy', 'capable', 'capital', 'captain', 'carbon', 'card', 'cargo', 'carpet',
  'carry', 'cart', 'case', 'castle', 'catalog', 'catch', 'cattle', 'caught',
  'cause', 'caution', 'cave', 'ceiling', 'celery', 'cement', 'census', 'century',
  'cereal', 'certain', 'chair', 'chalk', 'champion', 'change', 'chapter', 'charge',
  'chase', 'cheap', 'check', 'cheese', 'cherry', 'chest', 'chicken', 'chief',
  'child', 'choice', 'choose', 'chunk', 'circle', 'citizen', 'city', 'civil',
  'claim', 'clap', 'clarify', 'claw', 'clean', 'clerk', 'clever', 'click',
];

const DEFAULT_ITERATIONS = 100000;
const DEFAULT_SALT_LENGTH = 16;
const DEFAULT_IV_LENGTH = 12;

/**
 * Configuration for key backup operations.
 */
export interface KeyBackupConfig {
  /** Encryption algorithm for the backup */
  encryptionAlgorithm?: 'aes-256-gcm';
  /** Number of PBKDF2 iterations for key derivation */
  keyDerivationIterations?: number;
  /** Backup format */
  backupFormat?: 'encrypted-json' | 'mnemonic';
}

/**
 * An encrypted backup containing key material.
 */
export interface EncryptedBackup {
  /** Backup format version */
  version: number;
  /** Encryption algorithm used */
  algorithm: string;
  /** Base64-encoded salt for key derivation */
  salt: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Encrypted key material (base64-encoded) */
  data: string;
  /** Timestamp of backup creation */
  createdAt: number;
  /** SHA-256 checksum for integrity verification */
  checksum: string;
}

/**
 * Options for restoring keys from a backup.
 */
export interface RecoveryOptions {
  /** The encrypted backup to restore from */
  backup: EncryptedBackup;
  /** Passphrase used to encrypt the backup */
  passphrase: string;
}

/**
 * KeyBackup provides secure backup and recovery of encryption keys.
 *
 * Uses PBKDF2 for passphrase-based key derivation and AES-GCM for
 * encrypting the key material. Includes SHA-256 checksums for
 * integrity verification.
 */
export class KeyBackup {
  private readonly config: Required<KeyBackupConfig>;

  constructor(config: KeyBackupConfig = {}) {
    this.config = {
      encryptionAlgorithm: config.encryptionAlgorithm ?? 'aes-256-gcm',
      keyDerivationIterations: config.keyDerivationIterations ?? DEFAULT_ITERATIONS,
      backupFormat: config.backupFormat ?? 'encrypted-json',
    };
  }

  /**
   * Create an encrypted backup of a master key.
   *
   * @param masterKey - The master key to back up (CryptoKey or raw bytes)
   * @param passphrase - Passphrase to encrypt the backup with
   * @returns The encrypted backup
   *
   * @example
   * ```typescript
   * const backup = await keyBackup.createBackup(masterKey, 'my-passphrase');
   * const encoded = keyBackup.exportToString(backup);
   * ```
   */
  async createBackup(
    masterKey: CryptoKey | Uint8Array,
    passphrase: string
  ): Promise<EncryptedBackup> {
    const subtle = getSubtleCrypto();

    // Extract raw key bytes
    const keyBytes = masterKey instanceof Uint8Array
      ? masterKey
      : new Uint8Array(await subtle.exportKey('raw', masterKey));

    // Generate salt and IV
    const salt = randomBytes(DEFAULT_SALT_LENGTH);
    const iv = randomBytes(DEFAULT_IV_LENGTH);

    // Derive encryption key from passphrase
    const derivedKey = await this.deriveKeyFromPassphrase(passphrase, salt);

    // Encrypt the key material
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      derivedKey,
      keyBytes as unknown as BufferSource
    );

    const encryptedData = toBase64(new Uint8Array(encrypted));

    // Compute checksum over the encrypted data
    const checksum = await this.computeChecksum(encryptedData);

    return {
      version: 1,
      algorithm: 'aes-256-gcm',
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: encryptedData,
      createdAt: Date.now(),
      checksum,
    };
  }

  /**
   * Restore a master key from an encrypted backup.
   *
   * @param options - Recovery options containing backup and passphrase
   * @returns The decrypted key material
   *
   * @example
   * ```typescript
   * const restored = await keyBackup.restoreFromBackup({
   *   backup: encryptedBackup,
   *   passphrase: 'my-passphrase',
   * });
   * ```
   */
  async restoreFromBackup(options: RecoveryOptions): Promise<Uint8Array> {
    const { backup, passphrase } = options;
    const subtle = getSubtleCrypto();

    // Verify integrity
    const expectedChecksum = await this.computeChecksum(backup.data);
    if (expectedChecksum !== backup.checksum) {
      throw new Error('Backup integrity check failed: checksum mismatch');
    }

    // Derive decryption key from passphrase
    const salt = fromBase64(backup.salt);
    const iv = fromBase64(backup.iv);
    const derivedKey = await this.deriveKeyFromPassphrase(passphrase, salt);

    // Decrypt the key material
    const encryptedData = fromBase64(backup.data);
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      derivedKey,
      encryptedData as unknown as BufferSource
    );

    return new Uint8Array(decrypted);
  }

  /**
   * Verify a backup's integrity without performing a full restore.
   *
   * @param backup - The backup to verify
   * @param passphrase - The passphrase to verify decryption
   * @returns Whether the backup is valid and decryptable
   */
  async verifyBackup(backup: EncryptedBackup, passphrase: string): Promise<boolean> {
    try {
      await this.restoreFromBackup({ backup, passphrase });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a secure recovery phrase from a word list.
   *
   * @param length - Number of words in the phrase (default: 12)
   * @returns A space-separated recovery phrase
   *
   * @example
   * ```typescript
   * const phrase = keyBackup.generateRecoveryPhrase(12);
   * // "abandon ability able about above absent absorb abstract absurd abuse access accident"
   * ```
   */
  generateRecoveryPhrase(length = 12): string {
    const entropy = randomBytes(length);
    const words: string[] = [];

    for (let i = 0; i < length; i++) {
      const index = entropy[i]! % RECOVERY_WORD_LIST.length;
      words.push(RECOVERY_WORD_LIST[index]!);
    }

    return words.join(' ');
  }

  /**
   * Export an encrypted backup to a base64-encoded string for storage.
   *
   * @param backup - The backup to export
   * @returns Base64-encoded string representation
   */
  exportToString(backup: EncryptedBackup): string {
    const json = JSON.stringify(backup);
    const bytes = new TextEncoder().encode(json);
    return toBase64(bytes);
  }

  /**
   * Import an encrypted backup from a base64-encoded string.
   *
   * @param encoded - The base64-encoded backup string
   * @returns The parsed encrypted backup
   */
  importFromString(encoded: string): EncryptedBackup {
    const bytes = fromBase64(encoded);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as EncryptedBackup;
  }

  /**
   * Derive an AES-GCM key from a passphrase using PBKDF2.
   */
  private async deriveKeyFromPassphrase(
    passphrase: string,
    salt: Uint8Array
  ): Promise<CryptoKey> {
    const subtle = getSubtleCrypto();

    const passwordKey = await subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    return subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations: this.config.keyDerivationIterations,
        hash: 'SHA-256',
      },
      passwordKey,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Compute a SHA-256 checksum of data for integrity verification.
   */
  private async computeChecksum(data: string): Promise<string> {
    const subtle = getSubtleCrypto();
    const encoded = new TextEncoder().encode(data);
    const hash = await subtle.digest('SHA-256', encoded as unknown as BufferSource);
    return toBase64(new Uint8Array(hash));
  }
}

/**
 * Create a KeyBackup instance.
 *
 * @param config - Optional backup configuration
 * @returns A new KeyBackup instance
 *
 * @example
 * ```typescript
 * const keyBackup = createKeyBackup({ keyDerivationIterations: 200000 });
 * ```
 */
export function createKeyBackup(config?: KeyBackupConfig): KeyBackup {
  return new KeyBackup(config);
}
