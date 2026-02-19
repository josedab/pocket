# @pocket/presence

[![npm version](https://img.shields.io/npm/v/@pocket/presence.svg)](https://www.npmjs.com/package/@pocket/presence)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Real-time presence and multiplayer cursors for Pocket

> **Status:** 🟡 Beta — Feature-complete, has tests, API may change before 1.0.

## Installation

```bash
npm install @pocket/presence
```

**Peer dependencies:** `@pocket/core`

## Usage

```typescript
import { createPresenceManager, createCursorTracker } from '@pocket/presence';

const presence = createPresenceManager({
  userId: 'user-1',
  metadata: { name: 'Alice', color: '#ff0000' },
});

const cursors = createCursorTracker({ presence });

// React hook
const useCursors = createUseCursorsHook(cursors);
```

## API

| Export | Description |
|--------|-------------|
| `createPresenceManager(config)` | Manage user presence and status |
| `createCursorTracker(config)` | Track and broadcast cursor positions |
| `createTypingIndicator(config)` | Show typing indicators |
| `createCollaborationSession(config)` | Full collaboration session management |
| `createAwarenessProtocol(config)` | Yjs-compatible awareness protocol |

See the [source code](./src) and [TypeDoc API reference](https://pocket-db.github.io/pocket/) for full details.

## Development

```bash
# Build
npx turbo run build --filter=@pocket/presence

# Test
npx vitest run --project unit packages/presence/src/__tests__/

# Watch mode
npx vitest --project unit packages/presence/src/__tests__/
```

## License

MIT
