# Notes App Example

A notes application demonstrating Pocket's sync capabilities with a client-server architecture.

## What This Demonstrates

- **Client-server sync** using `@pocket/sync` with WebSocket transport
- **Sync server** via `@pocket/server` for real-time data synchronization
- **Conflict resolution** with last-write-wins strategy
- **Offline-first** design — works without the sync server running
- **Schema validation** with defaults and required fields

## Tech Stack

React · Vite · TypeScript · IndexedDB · WebSocket Sync

## Quick Start

From the **repository root**:

```bash
pnpm install
pnpm build

# Terminal 1: Start the sync server
pnpm --filter @pocket/example-notes-app server

# Terminal 2: Start the client
pnpm --filter @pocket/example-notes-app dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

> **Tip:** The app works without the sync server — data is stored locally in IndexedDB. Start the server to enable real-time sync across tabs/devices.

## Key Files

| File | Description |
|------|-------------|
| [`src/db.ts`](./src/db.ts) | Database and sync engine configuration |
| [`src/server.ts`](./src/server.ts) | Sync server entry point |
| [`src/App.tsx`](./src/App.tsx) | Main app component |
| [`src/NoteList.tsx`](./src/NoteList.tsx) | Note list with live queries |
| [`src/AddNote.tsx`](./src/AddNote.tsx) | Form for creating notes |
| [`src/SyncStatus.tsx`](./src/SyncStatus.tsx) | Sync connection status indicator |

## Learn More

- [Pocket Documentation](https://pocket-db.github.io/pocket/)
- [Sync Setup Guide](../../website/docs/guides/sync-setup.md)
- [React Integration Guide](../../website/docs/guides/react-integration.md)
- [Contributing Guide](../../CONTRIBUTING.md)
