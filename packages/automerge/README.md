# @pocket/automerge

Automerge CRDT integration for Pocket with conflict-free real-time sync.

## Installation

```bash
pnpm add @pocket/automerge
```

## Features

- Automerge CRDT-based sync adapter for Pocket
- Conflict-free document merging
- Real-time sync sessions with message passing
- Automatic merge resolution

## Usage

```typescript
import { createAutomergeSyncAdapter, createCrdtDocument } from '@pocket/automerge';

const adapter = createAutomergeSyncAdapter(db);
const doc = createCrdtDocument({ title: 'Hello' });
```

## API Reference

- `createAutomergeSyncAdapter` — Sync adapter using Automerge CRDTs
- `createCrdtDocument` — Create a CRDT-backed document
- `applyCrdtChanges` — Apply changes to a CRDT document
- `createSyncSession` — Establish a sync session between peers
- `mergeSyncMessages` — Merge incoming sync messages
- `createMergeResolver` — Custom merge resolution strategies

## License

MIT
