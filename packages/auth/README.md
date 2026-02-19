# @pocket/auth

[![npm version](https://img.shields.io/npm/v/@pocket/auth.svg)](https://www.npmjs.com/package/@pocket/auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local-first authentication for Pocket - JWT, passkeys, OAuth2 with offline support

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/auth
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createAuthManager, createTokenManager } from '@pocket/auth';

const auth = createAuthManager({
  database: db,
  providers: ['credentials', 'oauth2'],
});

// Authenticate a user
const session = await auth.signIn('credentials', {
  email: 'user@example.com',
  password: 'secret',
});

// Create a sync plugin with auth headers
const plugin = createAuthPlugin({ tokenManager: auth.tokenManager });
```

## API

| Export | Description |
|--------|-------------|
| `createAuthManager(config)` | Manage authentication with multiple providers |
| `createTokenManager(config)` | JWT token lifecycle management |
| `createOAuth2Provider(config)` | OAuth2 authentication provider |
| `createPasskeyProvider(config)` | WebAuthn/passkey provider |
| `createAuthPlugin(config)` | Pocket plugin for authenticated sync |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/auth

# Test
npx vitest run --project unit packages/auth/src/__tests__/

# Watch mode
npx vitest --project unit packages/auth/src/__tests__/
```

## License

MIT
