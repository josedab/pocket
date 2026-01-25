---
sidebar_position: 13
title: DevTools
description: Using Pocket DevTools for debugging and development
---

# DevTools

The `@pocket/devtools` package provides a browser extension and development utilities for inspecting and debugging Pocket databases.

## Installation

```bash
npm install @pocket/devtools --save-dev
```

## Browser Extension

### Chrome Extension Setup

1. Install the Pocket DevTools extension from the Chrome Web Store (coming soon)
2. Or load the unpacked extension from `node_modules/@pocket/devtools/extension`

### Manual Installation

1. Build the extension:
```bash
cd node_modules/@pocket/devtools
npm run build:extension
```

2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist/extension` folder

## Enabling DevTools

### Development Setup

```typescript
import { Database, createIndexedDBStorage } from '@pocket/core';
import { connectDevTools } from '@pocket/devtools';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

// Connect to DevTools in development only
if (process.env.NODE_ENV === 'development') {
  connectDevTools(db, {
    name: 'My App',
    // Enable time-travel debugging
    enableTimeTravel: true,
    // Maximum history size
    maxHistory: 100,
  });
}
```

### React Integration

```tsx
import { PocketProvider } from '@pocket/react';
import { DevToolsPanel } from '@pocket/devtools/react';

function App() {
  return (
    <PocketProvider database={db}>
      <YourApp />
      {process.env.NODE_ENV === 'development' && <DevToolsPanel />}
    </PocketProvider>
  );
}
```

## Features

### Collection Browser

View and edit all collections and documents:

- Browse collections in a tree view
- Search documents with filters
- Edit documents inline
- Create and delete documents
- View document history

### Query Inspector

Debug queries in real-time:

- See all executed queries
- View query execution time
- Inspect query results
- Copy queries for reproduction
- Explain query plans

### Live Updates

Monitor database changes as they happen:

- Real-time change feed
- Filter by collection or operation
- Highlight new/updated documents
- Track sync operations

### Time-Travel Debugging

Navigate through database state history:

```typescript
import { connectDevTools, timeTravel } from '@pocket/devtools';

connectDevTools(db, { enableTimeTravel: true });

// In your code or console
timeTravel.goBack(5);     // Go back 5 operations
timeTravel.goForward(2);  // Go forward 2 operations
timeTravel.goTo(42);      // Jump to specific state
timeTravel.reset();       // Reset to current state
```

### Performance Profiler

Analyze database performance:

- Operation timing breakdown
- Query performance metrics
- Memory usage tracking
- Slow query detection

## DevTools Panel

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Shift + P` | Toggle DevTools panel |
| `Ctrl/Cmd + K` | Quick search |
| `Ctrl/Cmd + Z` | Time-travel back |
| `Ctrl/Cmd + Shift + Z` | Time-travel forward |
| `Escape` | Close panel |

### Panel Sections

#### Collections Tab

```
┌─────────────────────────────────────────────────┐
│ Collections                          [+ New]    │
├─────────────────────────────────────────────────┤
│ 📁 todos (15)                                   │
│ 📁 users (3)                                    │
│ 📁 settings (1)                                 │
├─────────────────────────────────────────────────┤
│ 🔍 Search documents...                          │
├─────────────────────────────────────────────────┤
│ Document: abc-123                               │
│ ┌─────────────────────────────────────────────┐ │
│ │ {                                           │ │
│ │   "_id": "abc-123",                         │ │
│ │   "title": "Learn Pocket",                  │ │
│ │   "completed": false                        │ │
│ │ }                                           │ │
│ └─────────────────────────────────────────────┘ │
│ [Edit] [Delete] [Copy]                          │
└─────────────────────────────────────────────────┘
```

#### Queries Tab

```
┌─────────────────────────────────────────────────┐
│ Query History                      [Clear All]  │
├─────────────────────────────────────────────────┤
│ ▶ 12:34:56 | todos.find() | 2.3ms | 15 results │
│ ▶ 12:34:55 | todos.insert() | 1.2ms            │
│ ▶ 12:34:54 | users.get() | 0.8ms               │
├─────────────────────────────────────────────────┤
│ Selected Query:                                 │
│ todos.find().where('completed').equals(false)   │
│                                                 │
│ Execution Time: 2.3ms                           │
│ Results: 15 documents                           │
│ Index Used: idx_completed                       │
│                                                 │
│ [Run Again] [Copy] [Explain]                    │
└─────────────────────────────────────────────────┘
```

#### Changes Tab

```
┌─────────────────────────────────────────────────┐
│ Live Changes                    [Pause] [Clear] │
├─────────────────────────────────────────────────┤
│ 🟢 12:34:56 | INSERT | todos | abc-123          │
│ 🟡 12:34:55 | UPDATE | todos | def-456          │
│ 🔴 12:34:54 | DELETE | todos | ghi-789          │
│ 🔵 12:34:53 | SYNC   | todos | 3 documents      │
├─────────────────────────────────────────────────┤
│ Change Details:                                 │
│ Operation: INSERT                               │
│ Collection: todos                               │
│ Document ID: abc-123                            │
│ Timestamp: 2024-01-15T12:34:56.789Z            │
│                                                 │
│ Before: null                                    │
│ After: { "_id": "abc-123", "title": "..." }    │
└─────────────────────────────────────────────────┘
```

## Console API

Access DevTools from the browser console:

```javascript
// Access via global
const pocket = window.__POCKET_DEVTOOLS__;

// List collections
pocket.collections();

// Query a collection
await pocket.query('todos', { completed: false });

// Get document
await pocket.get('todos', 'doc-123');

// Insert document
await pocket.insert('todos', { title: 'Test' });

// Update document
await pocket.update('todos', 'doc-123', { completed: true });

// Delete document
await pocket.delete('todos', 'doc-123');

// Export database
const data = await pocket.export();

// Import data
await pocket.import(data);

// Clear collection
await pocket.clear('todos');

// Time travel
pocket.timeTravel.back();
pocket.timeTravel.forward();
pocket.timeTravel.goTo(42);
```

## Standalone DevTools

Run DevTools as a separate application:

```bash
npx pocket-devtools
```

This starts a web server with the DevTools UI at `http://localhost:3456`.

### Connect Remote Database

```typescript
import { connectRemoteDevTools } from '@pocket/devtools';

connectRemoteDevTools(db, {
  url: 'ws://localhost:3456',
  name: 'My App',
});
```

## Performance Monitoring

### Slow Query Detection

```typescript
connectDevTools(db, {
  slowQueryThreshold: 100, // ms
  onSlowQuery: (query, duration) => {
    console.warn(`Slow query detected: ${query} took ${duration}ms`);
  },
});
```

### Memory Monitoring

```typescript
connectDevTools(db, {
  trackMemory: true,
  memoryWarningThreshold: 50 * 1024 * 1024, // 50MB
  onMemoryWarning: (usage) => {
    console.warn(`High memory usage: ${usage / 1024 / 1024}MB`);
  },
});
```

## Testing Integration

### Mock DevTools

```typescript
import { createMockDevTools } from '@pocket/devtools/testing';

const mockDevTools = createMockDevTools();
connectDevTools(db, { mock: mockDevTools });

// Assert operations
expect(mockDevTools.getOperations()).toHaveLength(5);
expect(mockDevTools.getQueries('todos')).toContainEqual(
  expect.objectContaining({ filter: { completed: false } })
);
```

### Snapshot Testing

```typescript
import { createSnapshot, restoreSnapshot } from '@pocket/devtools/testing';

test('database operations', async () => {
  // Create snapshot of current state
  const snapshot = await createSnapshot(db);

  // Perform operations
  await db.collection('todos').insert({ ... });

  // Restore to previous state
  await restoreSnapshot(db, snapshot);
});
```

## Configuration Reference

```typescript
interface DevToolsConfig {
  // Display name in DevTools
  name?: string;

  // Enable time-travel debugging
  enableTimeTravel?: boolean;

  // Maximum history entries
  maxHistory?: number;

  // Slow query threshold in ms
  slowQueryThreshold?: number;

  // Track memory usage
  trackMemory?: boolean;

  // Memory warning threshold in bytes
  memoryWarningThreshold?: number;

  // Callbacks
  onSlowQuery?: (query: string, duration: number) => void;
  onMemoryWarning?: (usage: number) => void;
  onError?: (error: Error) => void;

  // Disable in production (default: auto-detect)
  enabled?: boolean;
}
```

## Security Considerations

DevTools should only be enabled in development:

```typescript
// Only connect in development
if (process.env.NODE_ENV === 'development') {
  connectDevTools(db);
}

// Or use conditional import
if (process.env.NODE_ENV === 'development') {
  const { connectDevTools } = await import('@pocket/devtools');
  connectDevTools(db);
}
```

Never expose DevTools in production as it allows:
- Reading all database contents
- Modifying data
- Deleting collections
- Exporting sensitive data

## Next Steps

- [Performance Guide](/docs/guides/performance) - Optimize your database
- [Testing Guide](/docs/guides/testing) - Test your Pocket code
- [Observability](/docs/guides/observability) - Production monitoring
