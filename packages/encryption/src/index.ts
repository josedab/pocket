// Types
export type * from './types.js';

// Crypto utilities
export * from './crypto-utils.js';

// Key management
export * from './key-manager.js';

// Encryption providers
export * from './encryption-provider.js';

// Document encryption
export * from './document-encryptor.js';

// Collection integration
export * from './encrypted-collection.js';

// E2E Sync
export {
  E2ESyncManager,
  createE2ESyncManager,
  type E2ESyncConfig,
  type E2ESyncStats,
  type E2ESyncStatus,
  type EncryptedSyncEnvelope,
} from './e2e-sync.js';

// Key Exchange
export {
  KeyExchangeManager,
  createKeyExchangeManager,
  type PairedDevice,
  type PairingRequest,
  type KeyExchangeEvent,
} from './key-exchange.js';

// Encrypted Index
export {
  EncryptedIndexManager,
  createEncryptedIndexManager,
  type EncryptedIndex,
  type EncryptedIndexEntry,
} from './encrypted-index.js';

// Key Backup & Recovery
export {
  KeyBackup,
  createKeyBackup,
  type KeyBackupConfig,
  type EncryptedBackup,
  type RecoveryOptions,
} from './key-backup.js';

// Group Encryption
export {
  GroupEncryption,
  createGroupEncryption,
  type GroupMember,
  type EncryptedGroupKey,
  type GroupEncryptionConfig,
} from './group-encryption.js';
