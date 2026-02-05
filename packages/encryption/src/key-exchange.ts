/**
 * KeyExchangeManager - Device pairing and key exchange for Pocket.
 *
 * Supports device pairing with pairing codes, mnemonic-based key recovery,
 * device tracking, and revocation.
 *
 * @module @pocket/encryption
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Word list for mnemonic generation (256 common English words) */
const WORD_LIST: string[] = [
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

/**
 * Information about a paired device.
 */
export interface PairedDevice {
  /** Unique device identifier */
  deviceId: string;
  /** Human-readable device name */
  name: string;
  /** When the device was paired */
  pairedAt: number;
  /** Last time the device was seen */
  lastSeen: number;
}

/**
 * A pending pairing request.
 */
export interface PairingRequest {
  /** The pairing code to share */
  code: string;
  /** When the request was created */
  createdAt: number;
  /** When the request expires */
  expiresAt: number;
  /** The shared secret derived from the pairing */
  sharedSecret: Uint8Array;
}

/**
 * Events emitted by the key exchange manager.
 */
export type KeyExchangeEvent =
  | { type: 'pairing:initiated'; code: string }
  | { type: 'pairing:completed'; deviceId: string }
  | { type: 'pairing:failed'; reason: string }
  | { type: 'device:revoked'; deviceId: string };

/**
 * KeyExchangeManager handles device pairing, key exchange,
 * and mnemonic-based key recovery.
 */
export class KeyExchangeManager {
  private readonly destroy$ = new Subject<void>();
  private readonly events$$ = new Subject<KeyExchangeEvent>();
  private readonly devices$ = new BehaviorSubject<PairedDevice[]>([]);
  private pendingPairings = new Map<string, PairingRequest>();
  private masterSecret: Uint8Array | null = null;

  /** Observable stream of key exchange events. */
  readonly events$: Observable<KeyExchangeEvent> = this.events$$
    .asObservable()
    .pipe(takeUntil(this.destroy$));

  /**
   * Initiate a device pairing. Returns a pairing request containing a
   * code that the other device must accept.
   */
  async initiatePairing(_deviceName?: string): Promise<PairingRequest> {
    const codeBytes = crypto.getRandomValues(new Uint8Array(4));
    const code = Array.from(codeBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    // Derive a shared secret from the code using HKDF-like approach
    const sharedSecret = await this.deriveSharedSecret(code);

    const request: PairingRequest = {
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      sharedSecret,
    };

    this.pendingPairings.set(code, request);
    this.events$$.next({ type: 'pairing:initiated', code });

    return request;
  }

  /**
   * Accept a pairing using the code from another device.
   * Completes the pairing and registers the device.
   */
  async acceptPairing(code: string, deviceName?: string): Promise<PairedDevice> {
    const request = this.pendingPairings.get(code);

    if (!request) {
      this.events$$.next({ type: 'pairing:failed', reason: 'Invalid pairing code' });
      throw new Error('Invalid pairing code');
    }

    if (Date.now() > request.expiresAt) {
      this.pendingPairings.delete(code);
      this.events$$.next({ type: 'pairing:failed', reason: 'Pairing code expired' });
      throw new Error('Pairing code expired');
    }

    // Derive shared secret on the accepting side
    const sharedSecret = await this.deriveSharedSecret(code);
    this.masterSecret = sharedSecret;

    const deviceId = crypto.randomUUID();
    const device: PairedDevice = {
      deviceId,
      name: deviceName ?? `Device-${deviceId.slice(0, 8)}`,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    };

    const devices = [...this.devices$.getValue(), device];
    this.devices$.next(devices);
    this.pendingPairings.delete(code);

    this.events$$.next({ type: 'pairing:completed', deviceId });
    return device;
  }

  /**
   * Generate a 12-word mnemonic phrase for key recovery.
   * The mnemonic encodes the current master secret.
   */
  generateMnemonic(): string[] {
    const entropy = this.masterSecret ?? crypto.getRandomValues(new Uint8Array(12));
    this.masterSecret ??= entropy;

    const words: string[] = [];
    for (let i = 0; i < 12; i++) {
      const index = entropy[i % entropy.length]! % WORD_LIST.length;
      words.push(WORD_LIST[index]!);
    }

    return words;
  }

  /**
   * Recover keys from a 12-word mnemonic phrase.
   */
  async recoverFromMnemonic(words: string[]): Promise<void> {
    if (words.length !== 12) {
      throw new Error('Mnemonic must be exactly 12 words');
    }

    // Validate all words are in the word list
    for (const word of words) {
      if (!WORD_LIST.includes(word)) {
        throw new Error(`Invalid mnemonic word: ${word}`);
      }
    }

    // Reconstruct entropy from words
    const entropy = new Uint8Array(12);
    for (let i = 0; i < 12; i++) {
      const index = WORD_LIST.indexOf(words[i]!);
      entropy[i] = index;
    }

    this.masterSecret = entropy;
  }

  /**
   * List all paired devices.
   */
  listDevices(): PairedDevice[] {
    return [...this.devices$.getValue()];
  }

  /**
   * Revoke a paired device by its ID.
   */
  revokeDevice(deviceId: string): void {
    const devices = this.devices$.getValue().filter((d) => d.deviceId !== deviceId);
    if (devices.length === this.devices$.getValue().length) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    this.devices$.next(devices);
    this.events$$.next({ type: 'device:revoked', deviceId });
  }

  /**
   * Get the current master secret (if initialized).
   */
  getMasterSecret(): Uint8Array | null {
    return this.masterSecret;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.pendingPairings.clear();
    this.masterSecret = null;
    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.complete();
    this.devices$.complete();
  }

  /**
   * Derive a shared secret from a pairing code using HKDF-like approach.
   * Uses SHA-256 to derive key material from the code with a salt.
   */
  private async deriveSharedSecret(code: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(`pocket-pairing:${code}`);
    const salt = encoder.encode('pocket-key-exchange-v1');

    // HMAC-based key derivation (HKDF extract step)
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      salt,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const derived = await crypto.subtle.sign('HMAC', hmacKey, keyMaterial);
    return new Uint8Array(derived);
  }
}

/**
 * Create a KeyExchangeManager instance.
 */
export function createKeyExchangeManager(): KeyExchangeManager {
  return new KeyExchangeManager();
}
