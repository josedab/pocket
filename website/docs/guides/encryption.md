---
sidebar_position: 12
title: Encryption
description: Encrypt sensitive data at rest with field-level encryption
---

# Encryption

Pocket provides client-side encryption to protect sensitive data at rest. Encrypt entire documents or specific fields using industry-standard algorithms.

## Overview

The `@pocket/encryption` package provides:
- **AES-256 encryption** using GCM or CBC modes
- **Password-based key derivation** using PBKDF2
- **Field-level encryption** to encrypt only sensitive fields
- **Key rotation** for security best practices
- **Compression** before encryption to reduce storage

## Installation

```bash
npm install @pocket/core @pocket/encryption
```

## Quick Start

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createEncryptedCollection } from '@pocket/encryption';

// Create database
const db = await Database.create({
  name: 'secure-app',
  storage: createIndexedDBStorage(),
});

// Create encrypted collection
const secureNotes = createEncryptedCollection(db.collection('notes'), {
  encryption: {
    algorithm: 'AES-GCM',
    keyConfig: {
      kdf: 'PBKDF2',
      iterations: 100000,
    },
  },
});

// Initialize with password
await secureNotes.initializeWithPassword('user-password');

// Insert encrypted document
await secureNotes.insert({
  title: 'Secret Note',
  content: 'This content is encrypted at rest',
});

// Read and automatically decrypt
const note = await secureNotes.get('note-id');
console.log(note.content); // Decrypted content
```

## Encryption Configuration

### Basic Configuration

```typescript
const encryptedCollection = createEncryptedCollection(collection, {
  encryption: {
    // Encryption algorithm
    algorithm: 'AES-GCM', // or 'AES-CBC'

    // Key derivation settings
    keyConfig: {
      kdf: 'PBKDF2',
      iterations: 100000, // Higher = more secure but slower
      keyLength: 256, // 256-bit key
    },

    // Optional: Compress before encrypting
    compress: true,
  },
});
```

### Field-Level Encryption

Encrypt only specific fields while leaving others readable:

```typescript
const encryptedCollection = createEncryptedCollection(collection, {
  encryption: {
    algorithm: 'AES-GCM',
    keyConfig: { kdf: 'PBKDF2' },

    // Only encrypt these fields
    encryptedFields: ['content', 'privateNotes', 'password'],
  },
});

// These fields are encrypted: content, privateNotes, password
// These remain readable: title, tags, createdAt
await encryptedCollection.insert({
  title: 'My Note', // Not encrypted
  content: 'Secret content', // Encrypted
  tags: ['work', 'important'], // Not encrypted
  privateNotes: 'Personal thoughts', // Encrypted
});
```

### Exclude Fields from Encryption

Alternatively, encrypt everything except specific fields:

```typescript
const encryptedCollection = createEncryptedCollection(collection, {
  encryption: {
    algorithm: 'AES-GCM',
    keyConfig: { kdf: 'PBKDF2' },

    // Encrypt all fields except these
    excludedFields: ['title', 'tags', 'isPublic'],
  },
});
```

### Key Rotation Configuration

Enable automatic key rotation for enhanced security:

```typescript
const encryptedCollection = createEncryptedCollection(collection, {
  encryption: {
    algorithm: 'AES-GCM',
    keyConfig: { kdf: 'PBKDF2' },
  },
  autoKeyRotation: true,
  keyRotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
});
```

## Encryption Algorithms

### AES-GCM (Recommended)

AES-GCM provides authenticated encryption with additional data (AEAD):

```typescript
encryption: {
  algorithm: 'AES-GCM',
  keyConfig: { kdf: 'PBKDF2' },
}
```

**Features:**
- Authenticated encryption (detects tampering)
- No padding required
- Parallelizable encryption/decryption
- 128-bit authentication tag

### AES-CBC

AES-CBC is a classic block cipher mode:

```typescript
encryption: {
  algorithm: 'AES-CBC',
  keyConfig: { kdf: 'PBKDF2' },
}
```

**Features:**
- Widely supported
- Uses PKCS#7 padding
- No built-in authentication (consider HMAC for integrity)

## Key Management

### Password-Based Initialization

Derive encryption keys from user passwords:

```typescript
// Initialize with user's password
await encryptedCollection.initializeWithPassword('strong-password-123');

// The key is derived using PBKDF2 with the configured iterations
// Higher iterations = more secure but slower initialization
```

### Key Export and Import

Export keys for backup or cross-device sync:

```typescript
// Export current key (store securely!)
const exportedKey = await encryptedCollection.exportCurrentKey();

// Import key on another device
await encryptedCollection.initializeWithKey(exportedKey);
```

### Manual Key Rotation

Rotate encryption keys periodically:

```typescript
// Rotate with new password
await encryptedCollection.rotateKey('new-password');

// Or rotate with auto-generated key
await encryptedCollection.rotateKey();

// All documents are re-encrypted with the new key
```

## Document Operations

### Insert

```typescript
const doc = await encryptedCollection.insert({
  title: 'Encrypted Document',
  content: 'This will be encrypted',
  sensitiveData: { ssn: '123-45-6789' },
});
```

### Get

```typescript
// Single document
const doc = await encryptedCollection.get('doc-id');

// Multiple documents
const docs = await encryptedCollection.getMany(['id-1', 'id-2']);

// All documents
const allDocs = await encryptedCollection.getAll();
```

### Update

```typescript
const updated = await encryptedCollection.update('doc-id', {
  content: 'Updated encrypted content',
});
```

### Delete

```typescript
await encryptedCollection.delete('doc-id');
```

## Encrypting Existing Data

Encrypt all unencrypted documents in a collection:

```typescript
const { encrypted, failed } = await encryptedCollection.encryptAll();
console.log(`Encrypted ${encrypted} documents, ${failed} failed`);
```

## State Monitoring

### Encryption State

```typescript
// Get current state
const state = encryptedCollection.getState();
console.log('Initialized:', state.initialized);
console.log('Current Key ID:', state.currentKeyId);
console.log('Encrypted Count:', state.encryptedCount);
console.log('Key Rotation Info:', state.keyRotation);

// Subscribe to state changes
encryptedCollection.state().subscribe((state) => {
  console.log('Encryption state updated:', state);
});
```

### Encryption Events

```typescript
encryptedCollection.events().subscribe((event) => {
  switch (event.type) {
    case 'key:derived':
      console.log('Key derived:', event.keyId);
      break;
    case 'key:rotated':
      console.log('Key rotated to:', event.keyId);
      break;
    case 'document:encrypted':
      console.log('Document encrypted:', event.documentId);
      break;
    case 'document:decrypted':
      console.log('Document decrypted:', event.documentId);
      break;
    case 'error':
      console.error('Encryption error:', event.error);
      break;
  }
});
```

## Low-Level API

For more control, use the lower-level encryption APIs directly.

### Document Encryptor

```typescript
import { createDocumentEncryptor, createKeyManager } from '@pocket/encryption';

// Create key manager
const keyManager = createKeyManager();

// Derive key from password
const key = await keyManager.deriveKey('password', {
  kdf: 'PBKDF2',
  iterations: 100000,
});

// Create document encryptor
const encryptor = createDocumentEncryptor(
  {
    algorithm: 'AES-GCM',
    keyConfig: { kdf: 'PBKDF2' },
    encryptedFields: ['content', 'secret'],
  },
  keyManager
);

// Set current key
encryptor.setCurrentKey(key.keyId);

// Encrypt document
const encrypted = await encryptor.encrypt({
  _id: 'doc-1',
  title: 'My Document',
  content: 'Secret content',
});

// Decrypt document
const decrypted = await encryptor.decrypt(encrypted);
```

### Encryption Providers

```typescript
import { getEncryptionProvider, createKeyManager } from '@pocket/encryption';

const provider = getEncryptionProvider('AES-GCM');
const keyManager = createKeyManager();
const key = await keyManager.generateKey('AES-GCM');

// Encrypt raw data
const data = new TextEncoder().encode('Secret message');
const encrypted = await provider.encrypt(data, key);

// Decrypt raw data
const decrypted = await provider.decrypt(encrypted, key);
const message = new TextDecoder().decode(decrypted);
```

### Crypto Utilities

```typescript
import {
  randomBytes,
  randomUUID,
  toBase64,
  fromBase64,
  stringToBytes,
  bytesToString,
  compress,
  decompress,
} from '@pocket/encryption';

// Generate random bytes
const iv = randomBytes(12);

// Generate UUID
const id = randomUUID();

// Base64 encoding
const encoded = toBase64(new Uint8Array([1, 2, 3]));
const decoded = fromBase64(encoded);

// String/bytes conversion
const bytes = stringToBytes('Hello');
const str = bytesToString(bytes);

// Compression (uses gzip)
const compressed = await compress(data);
const decompressed = await decompress(compressed);
```

## React Integration

### useEncryptedCollection Hook

```tsx
import { useState, useEffect, useCallback } from 'react';
import type { EncryptedCollection, EncryptedCollectionState } from '@pocket/encryption';

function useEncryptedCollection<T>(
  collection: EncryptedCollection<T>,
  password: string | null
) {
  const [state, setState] = useState<EncryptedCollectionState | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Subscribe to state
  useEffect(() => {
    const sub = collection.state().subscribe(setState);
    return () => sub.unsubscribe();
  }, [collection]);

  // Unlock with password
  const unlock = useCallback(async (pwd: string) => {
    setIsUnlocking(true);
    setError(null);
    try {
      await collection.initializeWithPassword(pwd);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unlock failed'));
    } finally {
      setIsUnlocking(false);
    }
  }, [collection]);

  // Auto-unlock if password provided
  useEffect(() => {
    if (password && !state?.initialized) {
      void unlock(password);
    }
  }, [password, state?.initialized, unlock]);

  return {
    state,
    isUnlocking,
    error,
    unlock,
    isLocked: !state?.initialized,
  };
}
```

### Password Entry Component

```tsx
function EncryptedVault({ collection }: { collection: EncryptedCollection<Note> }) {
  const [password, setPassword] = useState('');
  const { state, isUnlocking, error, unlock, isLocked } = useEncryptedCollection(
    collection,
    null
  );

  if (isLocked) {
    return (
      <div className="vault-lock">
        <h2>Unlock Vault</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
        />
        <button onClick={() => unlock(password)} disabled={isUnlocking}>
          {isUnlocking ? 'Unlocking...' : 'Unlock'}
        </button>
        {error && <p className="error">{error.message}</p>}
      </div>
    );
  }

  return <SecureNotes collection={collection} />;
}
```

## Security Best Practices

### 1. Use Strong Passwords

```typescript
// Good: Strong password policy
function validatePassword(password: string): boolean {
  return (
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
```

### 2. Use High Iteration Count

```typescript
// Good: 100,000+ iterations
keyConfig: {
  kdf: 'PBKDF2',
  iterations: 100000, // Minimum recommended
}

// Better: 250,000+ for sensitive data
keyConfig: {
  kdf: 'PBKDF2',
  iterations: 250000,
}
```

### 3. Enable Key Rotation

```typescript
// Rotate keys every 30-90 days
const encryptedCollection = createEncryptedCollection(collection, {
  encryption: {
    algorithm: 'AES-GCM',
    keyConfig: { kdf: 'PBKDF2' },
  },
  autoKeyRotation: true,
  keyRotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
});
```

### 4. Secure Key Export

```typescript
// Export key only when necessary
const exportedKey = await encryptedCollection.exportCurrentKey();

// Store in secure storage (e.g., platform keychain)
await SecureStore.setItemAsync('encryption-key', exportedKey);

// Never:
// - Store in localStorage
// - Log to console
// - Send over network unencrypted
```

### 5. Clear Sensitive Data

```typescript
// Clear keys when user logs out
function handleLogout() {
  encryptedCollection.dispose();
  // Key material is cleared from memory
}
```

### 6. Use AES-GCM

```typescript
// AES-GCM provides authenticated encryption
encryption: {
  algorithm: 'AES-GCM', // Detects tampering
  keyConfig: { kdf: 'PBKDF2' },
}
```

## Encrypted Data Format

When a document is encrypted, it's stored in this format:

```typescript
interface EncryptedDocument {
  _id: string;
  _rev?: string;
  _deleted?: boolean;
  _updatedAt?: number;
  _encrypted: {
    data: string; // Base64 encrypted content
    iv: string; // Base64 initialization vector
    tag?: string; // Base64 auth tag (AES-GCM only)
    algorithm: 'AES-GCM' | 'AES-CBC';
    version: number;
    compressed?: boolean;
  };
  _unencrypted?: Record<string, unknown>; // Unencrypted fields
}
```

## Complete Example

```typescript
import { Database, createIndexedDBStorage } from 'pocket';
import { createEncryptedCollection } from '@pocket/encryption';

interface SecureNote {
  _id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
}

// Setup
const db = await Database.create({
  name: 'secure-notes',
  storage: createIndexedDBStorage(),
});

const notes = db.collection<SecureNote>('notes');

// Create encrypted collection
const secureNotes = createEncryptedCollection(notes, {
  encryption: {
    algorithm: 'AES-GCM',
    keyConfig: {
      kdf: 'PBKDF2',
      iterations: 100000,
    },
    encryptedFields: ['content'], // Only encrypt content
    compress: true,
  },
  autoKeyRotation: true,
  keyRotationInterval: 30 * 24 * 60 * 60 * 1000,
});

// Initialize
await secureNotes.initializeWithPassword('user-master-password');

// Listen for events
secureNotes.events().subscribe((event) => {
  console.log(`Encryption event: ${event.type}`);
});

// CRUD operations
const note = await secureNotes.insert({
  title: 'My Secret Note',
  content: 'This is encrypted content that only the user can read.',
  tags: ['personal', 'important'],
  createdAt: Date.now(),
});

// Read back (automatically decrypted)
const retrieved = await secureNotes.get(note._id);
console.log(retrieved?.content); // Decrypted content

// Update
await secureNotes.update(note._id, {
  content: 'Updated encrypted content',
});

// Export key for backup
const keyBackup = await secureNotes.exportCurrentKey();
console.log('Save this key securely:', keyBackup);

// Later: rotate keys
await secureNotes.rotateKey('new-password');
```

## See Also

- [Schema Validation](/docs/guides/schema-validation) - Validate before encryption
- [Sync Setup](/docs/guides/sync-setup) - Sync encrypted data
- [React Native](/docs/guides/react-native) - Mobile encryption
