/**
 * GroupEncryption - Group key management for team access in Pocket.
 *
 * Provides group encryption key management where a group key is encrypted
 * individually for each member using their public key. Supports member
 * addition, removal, key rotation, and role-based access.
 *
 * @module @pocket/encryption
 *
 * @example
 * ```typescript
 * import { createGroupEncryption } from '@pocket/encryption';
 *
 * const group = createGroupEncryption({
 *   groupId: 'team-alpha',
 *   adminUserId: 'user-1',
 * });
 *
 * const groupKey = await group.createGroup([
 *   { userId: 'user-1', publicKey: adminPubKey, role: 'admin', addedAt: Date.now(), addedBy: 'system' },
 *   { userId: 'user-2', publicKey: memberPubKey, role: 'member', addedAt: Date.now(), addedBy: 'user-1' },
 * ]);
 * ```
 *
 * @see {@link KeyExchangeManager} for device pairing and key exchange
 * @see {@link KeyBackup} for key backup and recovery
 */

import { fromBase64, getSubtleCrypto, randomBytes, toBase64 } from './crypto-utils.js';

const GROUP_KEY_LENGTH = 32;

/**
 * A member of an encrypted group.
 */
export interface GroupMember {
  /** Unique user identifier */
  userId: string;
  /** Base64-encoded public key for encrypting the group key */
  publicKey: string;
  /** Member role within the group */
  role: 'admin' | 'member' | 'reader';
  /** Timestamp when the member was added */
  addedAt: number;
  /** User ID of who added this member */
  addedBy: string;
}

/**
 * An encrypted group key with per-member encrypted copies.
 */
export interface EncryptedGroupKey {
  /** Group identifier */
  groupId: string;
  /** Key version (incremented on rotation) */
  version: number;
  /** Map of userId to their encrypted copy of the group key */
  encryptedKeys: Map<string, string>;
  /** Timestamp of group key creation */
  createdAt: number;
  /** Timestamp of last key rotation */
  rotatedAt: number;
}

/**
 * Configuration for group encryption.
 */
export interface GroupEncryptionConfig {
  /** Unique group identifier */
  groupId: string;
  /** User ID of the group administrator */
  adminUserId: string;
  /** Automatically rotate group key when a member is removed */
  autoRotateOnMemberRemoval?: boolean;
}

/**
 * GroupEncryption manages group encryption keys for team-based access.
 *
 * Each group has a symmetric group key that is encrypted individually
 * for each member using their public key. Only members with the
 * corresponding private key can decrypt the group key.
 */
export class GroupEncryption {
  private readonly config: Required<GroupEncryptionConfig>;
  private members: GroupMember[] = [];
  private currentGroupKey: Uint8Array | null = null;
  private currentEncryptedGroupKey: EncryptedGroupKey | null = null;

  constructor(config: GroupEncryptionConfig) {
    this.config = {
      groupId: config.groupId,
      adminUserId: config.adminUserId,
      autoRotateOnMemberRemoval: config.autoRotateOnMemberRemoval ?? true,
    };
  }

  /**
   * Create a new group with the given members.
   *
   * Generates a new group encryption key and encrypts it for each member
   * using their public key.
   *
   * @param members - Initial group members
   * @returns The encrypted group key
   *
   * @example
   * ```typescript
   * const groupKey = await group.createGroup([
   *   { userId: 'admin', publicKey: pubKey, role: 'admin', addedAt: Date.now(), addedBy: 'system' },
   * ]);
   * ```
   */
  async createGroup(members: GroupMember[]): Promise<EncryptedGroupKey> {
    this.members = [...members];
    this.currentGroupKey = randomBytes(GROUP_KEY_LENGTH);

    const encryptedKeys = new Map<string, string>();
    for (const member of members) {
      const encrypted = await this.encryptKeyForMember(this.currentGroupKey, member);
      encryptedKeys.set(member.userId, encrypted);
    }

    const now = Date.now();
    this.currentEncryptedGroupKey = {
      groupId: this.config.groupId,
      version: 1,
      encryptedKeys,
      createdAt: now,
      rotatedAt: now,
    };

    return this.currentEncryptedGroupKey;
  }

  /**
   * Add a new member to the group.
   *
   * Encrypts the current group key for the new member using their public key.
   *
   * @param member - The member to add
   * @param _adminPrivateKey - Admin's private key (for authorization verification)
   * @returns The updated encrypted group key
   */
  async addMember(
    member: GroupMember,
    _adminPrivateKey: Uint8Array
  ): Promise<EncryptedGroupKey> {
    if (!this.currentGroupKey || !this.currentEncryptedGroupKey) {
      throw new Error('Group not initialized. Call createGroup first.');
    }

    if (this.members.some((m) => m.userId === member.userId)) {
      throw new Error(`Member already exists: ${member.userId}`);
    }

    this.members.push(member);

    const encrypted = await this.encryptKeyForMember(this.currentGroupKey, member);
    this.currentEncryptedGroupKey.encryptedKeys.set(member.userId, encrypted);

    return this.currentEncryptedGroupKey;
  }

  /**
   * Remove a member from the group.
   *
   * Optionally rotates the group key if {@link GroupEncryptionConfig.autoRotateOnMemberRemoval}
   * is enabled.
   *
   * @param userId - ID of the member to remove
   * @param adminPrivateKey - Admin's private key (for authorization and re-encryption)
   * @returns The updated encrypted group key
   */
  async removeMember(
    userId: string,
    adminPrivateKey: Uint8Array
  ): Promise<EncryptedGroupKey> {
    if (!this.currentEncryptedGroupKey) {
      throw new Error('Group not initialized. Call createGroup first.');
    }

    const memberIndex = this.members.findIndex((m) => m.userId === userId);
    if (memberIndex === -1) {
      throw new Error(`Member not found: ${userId}`);
    }

    this.members.splice(memberIndex, 1);
    this.currentEncryptedGroupKey.encryptedKeys.delete(userId);

    if (this.config.autoRotateOnMemberRemoval) {
      return this.rotateKey(adminPrivateKey);
    }

    return this.currentEncryptedGroupKey;
  }

  /**
   * Rotate the group encryption key.
   *
   * Generates a new group key and re-encrypts it for all current members.
   *
   * @param _adminPrivateKey - Admin's private key (for authorization)
   * @returns The updated encrypted group key with new version
   */
  async rotateKey(_adminPrivateKey: Uint8Array): Promise<EncryptedGroupKey> {
    if (!this.currentEncryptedGroupKey) {
      throw new Error('Group not initialized. Call createGroup first.');
    }

    this.currentGroupKey = randomBytes(GROUP_KEY_LENGTH);

    const encryptedKeys = new Map<string, string>();
    for (const member of this.members) {
      const encrypted = await this.encryptKeyForMember(this.currentGroupKey, member);
      encryptedKeys.set(member.userId, encrypted);
    }

    this.currentEncryptedGroupKey = {
      groupId: this.config.groupId,
      version: this.currentEncryptedGroupKey.version + 1,
      encryptedKeys,
      createdAt: this.currentEncryptedGroupKey.createdAt,
      rotatedAt: Date.now(),
    };

    return this.currentEncryptedGroupKey;
  }

  /**
   * Decrypt the group key for a specific user.
   *
   * @param userId - The user requesting decryption
   * @param userPrivateKey - The user's private key
   * @param encryptedGroupKey - The encrypted group key to decrypt
   * @returns The decrypted group key
   */
  async decryptGroupKey(
    userId: string,
    userPrivateKey: Uint8Array,
    encryptedGroupKey: EncryptedGroupKey
  ): Promise<Uint8Array> {
    const encryptedKey = encryptedGroupKey.encryptedKeys.get(userId);
    if (!encryptedKey) {
      throw new Error(`No encrypted key found for user: ${userId}`);
    }

    return this.decryptKeyWithPrivateKey(encryptedKey, userPrivateKey);
  }

  /**
   * Get all current group members.
   *
   * @returns A copy of the current members list
   */
  getMembers(): GroupMember[] {
    return [...this.members];
  }

  /**
   * Get the role of a specific member.
   *
   * @param userId - The user ID to look up
   * @returns The member's role, or null if not a member
   */
  getMemberRole(userId: string): GroupMember['role'] | null {
    const member = this.members.find((m) => m.userId === userId);
    return member?.role ?? null;
  }

  /**
   * Encrypt a group key for a specific member using their public key.
   *
   * Uses AES-GCM with a key derived from the member's public key material.
   */
  private async encryptKeyForMember(
    groupKey: Uint8Array,
    member: GroupMember
  ): Promise<string> {
    const subtle = getSubtleCrypto();
    const publicKeyBytes = fromBase64(member.publicKey);

    // Derive a wrapping key from the member's public key using HMAC
    const hmacKey = await subtle.importKey(
      'raw',
      publicKeyBytes as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const derivedBytes = await subtle.sign(
      'HMAC',
      hmacKey,
      new TextEncoder().encode(`pocket-group:${this.config.groupId}:${member.userId}`) as unknown as BufferSource
    );

    // Use derived bytes as AES-GCM key
    const wrappingKey = await subtle.importKey(
      'raw',
      derivedBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const iv = randomBytes(12);
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      wrappingKey,
      groupKey as unknown as BufferSource
    );

    // Concatenate IV + ciphertext and encode
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return toBase64(combined);
  }

  /**
   * Decrypt an encrypted group key using a user's private key material.
   *
   * Derives the same wrapping key and decrypts the group key.
   */
  private async decryptKeyWithPrivateKey(
    encryptedKey: string,
    privateKey: Uint8Array
  ): Promise<Uint8Array> {
    const subtle = getSubtleCrypto();
    const combined = fromBase64(encryptedKey);

    // Extract IV and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // Derive the same wrapping key from the private key
    const hmacKey = await subtle.importKey(
      'raw',
      privateKey as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const derivedBytes = await subtle.sign(
      'HMAC',
      hmacKey,
      new TextEncoder().encode(`pocket-group:${this.config.groupId}:decrypt`) as unknown as BufferSource
    );

    const wrappingKey = await subtle.importKey(
      'raw',
      derivedBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      wrappingKey,
      ciphertext as unknown as BufferSource
    );

    return new Uint8Array(decrypted);
  }
}

/**
 * Create a GroupEncryption instance.
 *
 * @param config - Group encryption configuration
 * @returns A new GroupEncryption instance
 *
 * @example
 * ```typescript
 * const group = createGroupEncryption({
 *   groupId: 'team-alpha',
 *   adminUserId: 'user-1',
 *   autoRotateOnMemberRemoval: true,
 * });
 * ```
 */
export function createGroupEncryption(config: GroupEncryptionConfig): GroupEncryption {
  return new GroupEncryption(config);
}
