# @pocket/encryption

[![npm version](https://img.shields.io/npm/v/@pocket/encryption.svg)](https://www.npmjs.com/package/@pocket/encryption)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

End-to-end encryption for Pocket local-first database

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/encryption
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createKeyManager, createDocumentEncryptor } from '@pocket/encryption';

const keyManager = createKeyManager({ storage: 'indexeddb' });
await keyManager.generateKey('my-key');

const encryptor = createDocumentEncryptor({ keyManager });

// Encrypt before storage
const encrypted = await encryptor.encrypt(document);

// Decrypt after retrieval
const decrypted = await encryptor.decrypt(encrypted);
```

## API

| Export | Description |
|--------|-------------|
| `createKeyManager(config)` | Manage encryption keys with secure storage |
| `createDocumentEncryptor(config)` | Encrypt and decrypt documents |
| `createEncryptedCollection(config)` | Collection wrapper with automatic encryption |
| `createEncryptionProvider(config)` | Pluggable encryption algorithm provider |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/encryption

# Test
npx vitest run --project unit packages/encryption/src/__tests__/

# Watch mode
npx vitest --project unit packages/encryption/src/__tests__/
```

## License

MIT
