# @pocket/electron

Electron integration for Pocket database.

## Installation

```bash
pnpm add @pocket/electron
```

## Features

- Main process database with IPC-based communication
- Renderer process client for seamless database access
- Collection accessors with full query builder support
- Re-exports core Pocket types for convenience

## Usage

```typescript
// Main process
import { MainProcessDatabase, IPC_CHANNELS } from '@pocket/electron';

const db = new MainProcessDatabase({ path: './data' });

// Renderer process
import { PocketClient } from '@pocket/electron';

const client = new PocketClient();
const users = client.collection('users');
const results = await users.find({ active: true });
```

## API Reference

- `MainProcessDatabase` — Database instance for the Electron main process
- `PocketClient` — Client for the renderer process
- `RendererCollection` — Collection accessor in the renderer
- `createCollectionAccessor` — Create a typed collection accessor
- `IPC_CHANNELS` — IPC channel constants

## License

MIT
