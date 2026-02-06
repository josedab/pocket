# @pocket/collaboration

[![npm](https://img.shields.io/npm/v/@pocket/collaboration.svg)](https://www.npmjs.com/package/@pocket/collaboration)
⚠️ **Experimental**

Real-time multiplayer collaboration engine for Pocket — CRDTs, presence, conflict resolution, and session management.

## Installation

```bash
npm install @pocket/collaboration @pocket/core
```

## Quick Start

```typescript
import { createCollabSession, createWebSocketTransport } from '@pocket/collaboration';
import { Database } from '@pocket/core';

const db = await Database.create({ name: 'my-app', storage });

// Create a WebSocket transport
const transport = createWebSocketTransport({
  url: 'wss://collab.example.com'
});

// Start a collaboration session
const session = createCollabSession({
  database: db,
  transport,
  user: { id: 'user-1', name: 'Alice', color: '#e74c3c' }
});

await session.join('document-room');
```

### Presence & Cursors

```typescript
import { createAwarenessProtocol, createCursorOverlay } from '@pocket/collaboration';

const awareness = createAwarenessProtocol({ session });
awareness.setLocalState({ cursor: { x: 100, y: 200 } });

const cursors = createCursorOverlay({ awareness });
```

### Conflict Resolution

```typescript
import { createConflictResolver } from '@pocket/collaboration';

const resolver = createConflictResolver({
  strategy: 'last-write-wins' // or 'merge', 'manual', custom function
});
```

## API

| Export | Description |
|--------|-------------|
| `createCollabSession(config)` | Start a collaboration session |
| `createWebSocketTransport(config)` | WebSocket-based transport |
| `createMemoryTransportHub()` | In-memory transport for testing |
| `createAwarenessProtocol(config)` | User presence and awareness |
| `createConflictResolver(config)` | Automatic conflict resolution |
| `createCursorOverlay(config)` | Remote cursor visualization |
| `createCommentingSystem(config)` | Inline commenting and threads |
| `createPermissionsManager(config)` | Role-based access control |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/collaboration)

## License

MIT
