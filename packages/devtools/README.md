# @pocket/devtools

[![npm](https://img.shields.io/npm/v/@pocket/devtools.svg)](https://www.npmjs.com/package/@pocket/devtools)

DevTools integration for Pocket — inspect, debug, and monitor your Pocket databases in real time.

## Installation

```bash
npm install @pocket/devtools
```

## Quick Start

```typescript
import { createDevToolsBridge, createInspector } from '@pocket/devtools';
import { Database } from '@pocket/core';

const db = await Database.create({ name: 'my-app', storage });

// Create a bridge to connect with browser DevTools
const bridge = createDevToolsBridge(db);

// Inspect database state
const inspector = createInspector(db);
const snapshot = await inspector.snapshot();
console.log(snapshot.collections);
```

## Features

- **Database Inspector** — browse collections, documents, and indexes
- **DevTools Bridge** — connect to browser developer tools panels
- **Real-time Monitoring** — observe database operations as they happen

## API

| Export | Description |
|--------|-------------|
| `createDevToolsBridge(db)` | Connect a database to the DevTools panel |
| `createInspector(db)` | Create an inspector for querying database state |

## Documentation

- [Full Documentation](https://pocket.dev/docs)
- [API Reference](https://pocket.dev/docs/api/devtools)

## License

MIT
