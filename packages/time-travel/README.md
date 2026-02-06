# @pocket/time-travel

[![npm](https://img.shields.io/npm/v/@pocket/time-travel.svg)](https://www.npmjs.com/package/@pocket/time-travel)
⚠️ **Experimental**

Time-travel debugging for Pocket — undo/redo, snapshots, history tracking, and audit exports.

## Installation

```bash
npm install @pocket/time-travel @pocket/core
```

## Quick Start

```typescript
import { createTimeTravelDebugger, createUndoRedoManager } from '@pocket/time-travel';
import { Database } from '@pocket/core';

const db = await Database.create({ name: 'my-app', storage });

// Full time-travel debugger
const debugger = createTimeTravelDebugger({ database: db });
await debugger.start();

// Step back and forward through history
await debugger.stepBack();
await debugger.stepForward();
await debugger.goToEntry(entryId);
```

### Undo/Redo

```typescript
const undoRedo = createUndoRedoManager({ database: db });

await todos.insert({ title: 'New todo', completed: false });
await undoRedo.undo(); // reverts the insert
await undoRedo.redo(); // re-applies the insert
```

### Snapshots

```typescript
import { createSnapshotEngine } from '@pocket/time-travel';

const snapshots = createSnapshotEngine({ database: db });
const snap = await snapshots.take('before-migration');

// Restore later
await snapshots.restore(snap.id);
```

### Audit Export

```typescript
import { createAuditExporter } from '@pocket/time-travel';

const exporter = createAuditExporter({ database: db });
const report = await exporter.export({
  from: new Date('2024-01-01'),
  format: 'json'
});
```

## API

| Export | Description |
|--------|-------------|
| `createTimeTravelDebugger(config)` | Full time-travel debugger |
| `createHistoryTracker(config)` | Track all database changes |
| `createUndoRedoManager(config)` | Undo/redo operations |
| `createSnapshotEngine(config)` | Take and restore snapshots |
| `createStateDiffEngine(config)` | Compare database states |
| `createAuditExporter(config)` | Export audit logs |
| `createPersistentHistory(config)` | Persist history to storage |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/time-travel)

## License

MIT
