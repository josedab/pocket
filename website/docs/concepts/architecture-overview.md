---
sidebar_position: 0
title: Architecture Overview
description: Complete system architecture of Pocket database
---

# Architecture Overview

This page provides a comprehensive view of Pocket's architecture, showing how all components work together to create a local-first database experience.

## System Architecture

```mermaid
flowchart TB
    subgraph Application["Application Layer"]
        React["React / Vue / Svelte"]
        Vanilla["Vanilla JS"]
    end

    subgraph SDK["Framework SDKs"]
        ReactHooks["@pocket/react<br/>useLiveQuery, useMutation"]
        VueComposables["@pocket/vue<br/>useCollection, useQuery"]
        SvelteStores["@pocket/svelte<br/>Stores"]
    end

    subgraph Core["@pocket/core"]
        Database["Database"]
        Collection["Collections"]
        QueryEngine["Query Engine"]
        Observable["Observable System"]
        Plugins["Plugin System"]
    end

    subgraph Storage["Storage Layer"]
        StorageInterface["Storage Interface"]
        IndexedDB["@pocket/storage-indexeddb"]
        OPFS["@pocket/storage-opfs"]
        SQLite["@pocket/storage-sqlite"]
        Memory["@pocket/storage-memory"]
    end

    subgraph Sync["Sync Layer (Optional)"]
        SyncEngine["@pocket/sync"]
        Transport["Transport Layer"]
        ConflictRes["Conflict Resolution"]
    end

    subgraph Server["Server (Optional)"]
        SyncServer["@pocket/server"]
        YourBackend["Your Backend"]
    end

    React --> ReactHooks
    Vanilla --> Core

    ReactHooks --> Core
    VueComposables --> Core
    SvelteStores --> Core

    Core --> Database
    Database --> Collection
    Database --> QueryEngine
    Database --> Observable
    Database --> Plugins

    Collection --> StorageInterface
    StorageInterface --> IndexedDB
    StorageInterface --> OPFS
    StorageInterface --> SQLite
    StorageInterface --> Memory

    Database -.-> SyncEngine
    SyncEngine --> Transport
    SyncEngine --> ConflictRes
    Transport -.-> SyncServer
    Transport -.-> YourBackend
```

## Core Components

### Database

The `Database` class is the entry point for all Pocket operations. It manages collections, coordinates storage, and handles the reactive system.

```typescript
import { Database, createIndexedDBStorage } from 'pocket';

const db = await Database.create({
  name: 'my-app',
  storage: createIndexedDBStorage(),
  plugins: [/* optional plugins */],
});
```

**Responsibilities:**
- Collection management and lifecycle
- Storage adapter coordination
- Plugin registration and execution
- Change propagation to reactive queries

### Collections

Collections store documents of a specific type. They provide CRUD operations and query capabilities.

```typescript
interface User {
  _id: string;
  name: string;
  email: string;
}

const users = db.collection<User>('users');
```

**Key Features:**
- Type-safe document operations
- Automatic ID generation
- Change tracking for reactivity
- Index management

### Query Engine

The query engine provides a fluent API for building and executing queries.

```typescript
const results = await users
  .find()
  .where('age').gte(18)
  .where('status').equals('active')
  .sort('name', 'asc')
  .limit(10)
  .exec();
```

**Capabilities:**
- Comparison operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`)
- Logical operators (`and`, `or`, `not`)
- Array operators (`in`, `nin`, `contains`)
- String operators (`startsWith`, `endsWith`, `regex`)
- Sorting and pagination
- Index utilization

### Observable System

The observable system enables reactive queries that automatically update when data changes.

```mermaid
sequenceDiagram
    participant App as Application
    participant Query as Live Query
    participant DB as Database
    participant Storage as Storage

    App->>Query: Subscribe to query
    Query->>DB: Register subscription
    DB->>Storage: Execute initial query
    Storage-->>DB: Initial results
    DB-->>Query: Emit results
    Query-->>App: Update UI

    Note over App,Storage: Later: Data changes

    App->>DB: Insert/Update document
    DB->>Storage: Persist change
    DB->>Query: Notify change
    Query->>DB: Re-evaluate query
    DB->>Storage: Execute query
    Storage-->>DB: Updated results
    DB-->>Query: Emit new results
    Query-->>App: Update UI
```

## Storage Architecture

Pocket uses a pluggable storage architecture that supports multiple backends.

### Storage Interface

All storage adapters implement a common interface:

```typescript
interface StorageAdapter {
  // Document operations
  get(collection: string, id: string): Promise<Document | null>;
  getMany(collection: string, ids: string[]): Promise<Document[]>;
  put(collection: string, doc: Document): Promise<void>;
  delete(collection: string, id: string): Promise<void>;

  // Query operations
  find(collection: string, query: Query): Promise<Document[]>;
  count(collection: string, query: Query): Promise<number>;

  // Index operations
  createIndex(collection: string, index: IndexDefinition): Promise<void>;
  dropIndex(collection: string, indexName: string): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
  destroy(): Promise<void>;
}
```

### Storage Backends

| Backend | Best For | Browser Support | Performance |
|---------|----------|-----------------|-------------|
| **IndexedDB** | General use | All modern browsers | Good |
| **OPFS** | Large datasets | Chrome, Edge, Firefox | Excellent |
| **SQLite** | Node.js/Electron | N/A (server) | Excellent |
| **Memory** | Testing | All | Fastest (no persistence) |

```mermaid
flowchart LR
    subgraph Browser
        IDB[(IndexedDB)]
        OPFS[(OPFS)]
        Mem[(Memory)]
    end

    subgraph Server
        SQLite[(SQLite)]
        Postgres[(PostgreSQL)]
    end

    App[Application] --> Storage{Storage Adapter}
    Storage --> IDB
    Storage --> OPFS
    Storage --> Mem
    Storage --> SQLite
    Storage --> Postgres
```

## Sync Architecture

The sync layer enables multi-device synchronization while maintaining local-first principles.

### Sync Flow

```mermaid
sequenceDiagram
    participant Client1 as Client 1
    participant Server as Sync Server
    participant Client2 as Client 2

    Note over Client1,Client2: Initial State

    Client1->>Client1: Local write
    Client1->>Server: Push changes
    Server->>Server: Store & resolve conflicts
    Server->>Client2: Push changes
    Client2->>Client2: Apply changes

    Note over Client1,Client2: Offline scenario

    Client1->>Client1: Offline write (queued)
    Client2->>Client2: Offline write (queued)

    Note over Client1,Client2: Back online

    Client1->>Server: Push queued changes
    Client2->>Server: Push queued changes
    Server->>Server: Detect conflict
    Server->>Server: Resolve (LWW/CRDT/Custom)
    Server->>Client1: Resolved state
    Server->>Client2: Resolved state
```

### Conflict Resolution Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **Last-Write-Wins** | Latest timestamp wins | Simple data, low conflict |
| **Field-Level Merge** | Merge non-conflicting fields | User profiles, settings |
| **CRDT** | Mathematically guaranteed merge | Collaborative editing |
| **Custom** | Application-specific logic | Complex business rules |

### Transport Layer

The sync engine supports multiple transports:

```typescript
import { createSyncEngine } from '@pocket/sync';
import { createWebSocketTransport, createHTTPTransport } from '@pocket/sync/transport';

// WebSocket for real-time sync
const wsSync = createSyncEngine(db, {
  transport: createWebSocketTransport({
    url: 'wss://api.example.com/sync',
  }),
});

// HTTP for polling-based sync
const httpSync = createSyncEngine(db, {
  transport: createHTTPTransport({
    url: 'https://api.example.com/sync',
    pollInterval: 30000,
  }),
});
```

## Plugin Architecture

Pocket's plugin system allows extending core functionality.

```mermaid
flowchart TB
    subgraph Plugins
        Encryption["@pocket/encryption"]
        CRDT["@pocket/crdt"]
        Vectors["@pocket/vectors"]
        DevTools["@pocket/devtools"]
        Custom["Custom Plugin"]
    end

    subgraph Hooks
        BeforeWrite["beforeWrite"]
        AfterWrite["afterWrite"]
        BeforeRead["beforeRead"]
        AfterRead["afterRead"]
        OnSync["onSync"]
    end

    Database[Database] --> Hooks
    Hooks --> Plugins
```

### Plugin Interface

```typescript
interface PocketPlugin {
  name: string;

  // Lifecycle hooks
  onInit?(db: Database): void | Promise<void>;
  onDestroy?(db: Database): void | Promise<void>;

  // Document hooks
  beforeWrite?(doc: Document, collection: string): Document | Promise<Document>;
  afterWrite?(doc: Document, collection: string): void | Promise<void>;
  beforeRead?(doc: Document, collection: string): Document | Promise<Document>;
  afterRead?(doc: Document, collection: string): void | Promise<void>;

  // Sync hooks
  beforeSync?(changes: Change[]): Change[] | Promise<Change[]>;
  afterSync?(changes: Change[]): void | Promise<void>;
}
```

### Built-in Plugins

| Plugin | Purpose |
|--------|---------|
| **@pocket/encryption** | End-to-end encryption for documents |
| **@pocket/crdt** | CRDT-based conflict resolution |
| **@pocket/vectors** | Vector embeddings for AI/ML |
| **@pocket/devtools** | Browser DevTools integration |
| **@pocket/opentelemetry** | Observability and tracing |

## Data Flow

### Write Path

```mermaid
flowchart LR
    A[Application] --> B[Collection.insert]
    B --> C{Plugins: beforeWrite}
    C --> D[Schema Validation]
    D --> E[Storage Adapter]
    E --> F[Persist to Storage]
    F --> G{Plugins: afterWrite}
    G --> H[Notify Observers]
    H --> I[Update Live Queries]
    I --> J[Queue for Sync]
```

### Read Path

```mermaid
flowchart LR
    A[Application] --> B[Collection.find]
    B --> C[Query Builder]
    C --> D[Query Optimizer]
    D --> E{Use Index?}
    E -->|Yes| F[Index Scan]
    E -->|No| G[Collection Scan]
    F --> H[Storage Adapter]
    G --> H
    H --> I[Filter & Sort]
    I --> J{Plugins: afterRead}
    J --> K[Return Results]
```

## Performance Considerations

### Bundle Size

Pocket is designed to be tree-shakeable. Import only what you need:

```typescript
// Full bundle (~50KB)
import { Database, createIndexedDBStorage } from 'pocket';

// Minimal bundle (~25KB)
import { Database } from '@pocket/core';
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';
```

### Memory Management

- **Query caching**: Frequently used queries are cached
- **Lazy loading**: Collections are loaded on first access
- **Subscription cleanup**: Automatic cleanup of unused subscriptions
- **Batch operations**: Group multiple writes for efficiency

### Indexing Strategy

Create indexes for frequently queried fields:

```typescript
// Create compound index
await users.createIndex({
  name: 'status_created',
  fields: ['status', 'createdAt'],
});

// Query uses the index automatically
const activeUsers = await users
  .find()
  .where('status').equals('active')
  .sort('createdAt', 'desc')
  .exec();
```

## Security Model

```mermaid
flowchart TB
    subgraph Client["Client-Side Security"]
        Encryption["Document Encryption"]
        Validation["Schema Validation"]
        Sanitization["Input Sanitization"]
    end

    subgraph Server["Server-Side Security"]
        Auth["Authentication"]
        AuthZ["Authorization"]
        RateLimit["Rate Limiting"]
    end

    subgraph Transport["Transport Security"]
        TLS["TLS/HTTPS"]
        WSS["WSS (WebSocket Secure)"]
    end

    App[Application] --> Client
    Client --> Transport
    Transport --> Server
```

### Security Features

- **Client-side encryption**: Encrypt sensitive data before storage
- **Schema validation**: Prevent malformed data
- **Transport encryption**: TLS for all network communication
- **Server authorization**: Row-level security on sync server

## See Also

- [Local-First Architecture](/docs/concepts/local-first) - Why local-first matters
- [Database Model](/docs/concepts/database-model) - Document structure and collections
- [Reactive Queries](/docs/concepts/reactive-queries) - How live queries work
- [Storage Backends](/docs/concepts/storage-backends) - Storage options in detail
- [Sync Architecture](/docs/concepts/sync-architecture) - Sync protocol details
