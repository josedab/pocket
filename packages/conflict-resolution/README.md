# @pocket/conflict-resolution

Conflict resolution UI components and utilities for Pocket.

## Installation

```bash
pnpm add @pocket/conflict-resolution
```

## Features

- Analyze sync conflicts with detailed diff information
- Manage and resolve conflicts programmatically
- React hooks for conflict notifications and conflict lists
- Configurable resolution strategies

## Usage

```typescript
import { createConflictManager, createConflictAnalyzer } from '@pocket/conflict-resolution';

const analyzer = createConflictAnalyzer(db);
const conflicts = await analyzer.detectConflicts();

const manager = createConflictManager(db);
await manager.resolve(conflictId, 'local');
```

## API Reference

- `createConflictAnalyzer` / `ConflictAnalyzer` — Detect and analyze conflicts
- `createConflictManager` / `ConflictManager` — Resolve conflicts
- `createUseConflictsHook` — React hook for listing conflicts
- `createUseConflictNotificationsHook` — React hook for conflict notifications
- `DEFAULT_CONFLICT_CONFIG` — Default configuration

## License

MIT
