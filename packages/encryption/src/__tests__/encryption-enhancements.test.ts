import { describe, expect, it, beforeEach } from 'vitest';
import { KeyBackup, createKeyBackup } from '../key-backup.js';
import {
  GroupEncryption,
  createGroupEncryption,
  type GroupMember,
} from '../group-encryption.js';
import { toBase64, randomBytes } from '../crypto-utils.js';

// ─── KeyBackup Tests ──────────────────────────────────────────────────────────

describe('KeyBackup', () => {
  let backup: KeyBackup;

  beforeEach(() => {
    backup = createKeyBackup();
  });

  describe('generateRecoveryPhrase', () => {
    it('should generate a recovery phrase with specified word count', () => {
      const phrase12 = backup.generateRecoveryPhrase(12);
      expect(phrase12.split(' ')).toHaveLength(12);

      const phrase24 = backup.generateRecoveryPhrase(24);
      expect(phrase24.split(' ')).toHaveLength(24);

      const phrase6 = backup.generateRecoveryPhrase(6);
      expect(phrase6.split(' ')).toHaveLength(6);
    });
  });

  describe('exportToString / importFromString', () => {
    it('should export backup to string and import back (round-trip)', async () => {
      const masterKey = randomBytes(32);
      const passphrase = 'test-passphrase-secure';

      const encrypted = await backup.createBackup(masterKey, passphrase);
      const exported = backup.exportToString(encrypted);

      expect(typeof exported).toBe('string');
      expect(exported.length).toBeGreaterThan(0);

      const imported = backup.importFromString(exported);

      expect(imported.version).toBe(encrypted.version);
      expect(imported.algorithm).toBe(encrypted.algorithm);
      expect(imported.salt).toBe(encrypted.salt);
      expect(imported.iv).toBe(encrypted.iv);
      expect(imported.data).toBe(encrypted.data);
      expect(imported.checksum).toBe(encrypted.checksum);
      expect(imported.createdAt).toBe(encrypted.createdAt);
    });
  });
});

// ─── GroupEncryption Tests ────────────────────────────────────────────────────

describe('GroupEncryption', () => {
  let group: GroupEncryption;
  let members: GroupMember[];

  beforeEach(() => {
    group = createGroupEncryption({
      groupId: 'test-group',
      adminUserId: 'admin-1',
      autoRotateOnMemberRemoval: false,
    });

    members = [
      {
        userId: 'admin-1',
        publicKey: toBase64(randomBytes(32)),
        role: 'admin',
        addedAt: Date.now(),
        addedBy: 'system',
      },
      {
        userId: 'member-1',
        publicKey: toBase64(randomBytes(32)),
        role: 'member',
        addedAt: Date.now(),
        addedBy: 'admin-1',
      },
    ];
  });

  it('should create group with members', async () => {
    const groupKey = await group.createGroup(members);

    expect(groupKey.groupId).toBe('test-group');
    expect(groupKey.version).toBe(1);
    expect(groupKey.encryptedKeys.size).toBe(2);
    expect(groupKey.encryptedKeys.has('admin-1')).toBe(true);
    expect(groupKey.encryptedKeys.has('member-1')).toBe(true);
    expect(groupKey.createdAt).toBeGreaterThan(0);
  });

  it('should return member list', async () => {
    await group.createGroup(members);
    const result = group.getMembers();

    expect(result).toHaveLength(2);
    expect(result[0]!.userId).toBe('admin-1');
    expect(result[1]!.userId).toBe('member-1');
    // Verify it returns a copy
    result.push(members[0]!);
    expect(group.getMembers()).toHaveLength(2);
  });

  it('should get member role by userId', async () => {
    await group.createGroup(members);

    expect(group.getMemberRole('admin-1')).toBe('admin');
    expect(group.getMemberRole('member-1')).toBe('member');
  });

  it('should return null for unknown member role', async () => {
    await group.createGroup(members);

    expect(group.getMemberRole('unknown-user')).toBeNull();
  });

  it('should add a member to the group', async () => {
    await group.createGroup(members);

    const newMember: GroupMember = {
      userId: 'member-2',
      publicKey: toBase64(randomBytes(32)),
      role: 'reader',
      addedAt: Date.now(),
      addedBy: 'admin-1',
    };

    const adminPrivateKey = randomBytes(32);
    const updatedKey = await group.addMember(newMember, adminPrivateKey);

    expect(updatedKey.encryptedKeys.size).toBe(3);
    expect(updatedKey.encryptedKeys.has('member-2')).toBe(true);
    expect(group.getMembers()).toHaveLength(3);
    expect(group.getMemberRole('member-2')).toBe('reader');
  });

  it('should remove a member from the group', async () => {
    await group.createGroup(members);

    const adminPrivateKey = randomBytes(32);
    const updatedKey = await group.removeMember('member-1', adminPrivateKey);

    expect(updatedKey.encryptedKeys.has('member-1')).toBe(false);
    expect(updatedKey.encryptedKeys.size).toBe(1);
    expect(group.getMembers()).toHaveLength(1);
    expect(group.getMemberRole('member-1')).toBeNull();
  });
});
