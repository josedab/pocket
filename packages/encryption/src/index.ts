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
  type KeyExchangeEvent,
  type PairedDevice,
  type PairingRequest,
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
  type EncryptedBackup,
  type KeyBackupConfig,
  type RecoveryOptions,
} from './key-backup.js';

// Group Encryption
export {
  GroupEncryption,
  createGroupEncryption,
  type EncryptedGroupKey,
  type GroupEncryptionConfig,
  type GroupMember,
} from './group-encryption.js';

// Encrypted Sync Pipeline
export {
  EncryptedSyncPipeline,
  createEncryptedSyncPipeline,
  type DerivedKeyInfo,
  type EncryptedPayload,
  type EncryptedSyncConfig,
  type EncryptedSyncStats,
  type KeyDerivationConfig,
  type KeyRotationEvent,
} from './encrypted-sync-pipeline.js';

// Web Crypto Provider
export {
  WebCryptoProvider,
  createWebCryptoProvider,
  toBase64 as webCryptoToBase64,
  fromBase64 as webCryptoFromBase64,
  type CryptoProvider,
  type WebCryptoConfig,
  type KeyDerivationParams,
} from './web-crypto-provider.js';

// Encrypted Sync Transport
export {
  EncryptedSyncTransport,
  createEncryptedSyncTransport,
  type EncryptedSyncTransportConfig,
  type EncryptedDocument as SyncEncryptedDocument,
  type KeyInfo as SyncKeyInfo,
} from './encrypted-sync.js';
