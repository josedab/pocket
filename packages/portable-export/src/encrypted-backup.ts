/**
 * @module @pocket/portable-export/encrypted-backup
 *
 * Encrypted backup export/import using AES-GCM encryption.
 * Supports password-based key derivation (PBKDF2) for secure backups.
 *
 * @example
 * ```typescript
 * const backup = createEncryptedBackup();
 * const encrypted = await backup.encrypt(exportData, 'my-password');
 * const decrypted = await backup.decrypt(encrypted, 'my-password');
 * ```
 */
import type { ExportResult } from './types.js';

export interface EncryptedBackupConfig {
  iterations?: number;
  saltLength?: number;
}

export interface EncryptedPayload {
  version: string;
  algorithm: 'aes-256-gcm';
  kdf: 'pbkdf2';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  checksum: string;
}

export interface EncryptedBackup {
  encrypt(data: string, password: string): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload, password: string): Promise<string>;
  encryptExport(result: ExportResult, password: string): Promise<EncryptedPayload>;
  isEncryptedPayload(data: unknown): data is EncryptedPayload;
}

function toBase64(buffer: Uint8Array): string {
  const bytes: string[] = [];
  for (const byte of buffer) {
    bytes.push(String.fromCharCode(byte));
  }
  return btoa(bytes.join(''));
}

function fromBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function simpleHash(data: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createEncryptedBackup(config?: EncryptedBackupConfig): EncryptedBackup {
  const iterations = config?.iterations ?? 100000;
  const saltLength = config?.saltLength ?? 16;

  async function encrypt(data: string, password: string): Promise<EncryptedPayload> {
    const salt = crypto.getRandomValues(new Uint8Array(saltLength));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, iterations);

    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );

    return {
      version: '1.0.0',
      algorithm: 'aes-256-gcm',
      kdf: 'pbkdf2',
      iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(encrypted)),
      checksum: simpleHash(data),
    };
  }

  async function decrypt(payload: EncryptedPayload, password: string): Promise<string> {
    if (payload.algorithm !== 'aes-256-gcm') {
      throw new Error(`Unsupported algorithm: ${payload.algorithm}`);
    }

    const salt = fromBase64(payload.salt);
    const iv = fromBase64(payload.iv);
    const encryptedData = fromBase64(payload.data);
    const key = await deriveKey(password, salt, payload.iterations);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedData);

    const decoder = new TextDecoder();
    const result = decoder.decode(decrypted);

    if (simpleHash(result) !== payload.checksum) {
      throw new Error('Checksum mismatch: data may be corrupted');
    }

    return result;
  }

  async function encryptExport(result: ExportResult, password: string): Promise<EncryptedPayload> {
    return encrypt(result.data, password);
  }

  function isEncryptedPayload(data: unknown): data is EncryptedPayload {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
      obj.version !== undefined &&
      obj.algorithm === 'aes-256-gcm' &&
      obj.kdf === 'pbkdf2' &&
      typeof obj.salt === 'string' &&
      typeof obj.iv === 'string' &&
      typeof obj.data === 'string'
    );
  }

  return { encrypt, decrypt, encryptExport, isEncryptedPayload };
}
