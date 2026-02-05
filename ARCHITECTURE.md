# Pocket Architecture

This document provides a comprehensive overview of Pocket's architecture, package structure, and design decisions.

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Package Structure](#package-structure)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Storage Layer](#storage-layer)
- [Sync Architecture](#sync-architecture)
- [Extension System](#extension-system)
- [Design Decisions](#design-decisions)

## Overview

Pocket is a **local-first database** for web applications. The core philosophy is:

1. **Data lives on the client** - All reads and writes happen locally first
2. **Works offline by default** - No network required for basic operations
3. **Sync is optional** - Add server synchronization when needed
4. **Type-safe by design** - Full TypeScript support with strict typing
5. **Modular architecture** - Use only what you need

## System Architecture

```mermaid
graph TB
    subgraph Application["Application Layer"]
        UI[React/JS Application]
        Hooks[React Hooks]
    end

    subgraph Pocket["Pocket Core"]
        DB[Database]
        Collections[Collections]
        Query[Query Engine]
        Observable[Reactive System]
        Plugins[Plugin System]
    end

    subgraph Storage["Storage Layer"]
        IDB[(IndexedDB)]
        OPFS[(OPFS)]
        SQLite[(SQLite)]
        Memory[(Memory)]
    end

    subgraph Sync["Sync Layer"]
        SyncEngine[Sync Engine]
        Transport[Transport Layer]
        Conflict[Conflict Resolution]
    end

    subgraph Server["Server Layer"]
        SyncServer[Sync Server]
        ServerDB[(Server Database)]
    end

    UI --> Hooks
    Hooks --> DB
    DB --> Collections
    Collections --> Query
    Query --> Observable
    Observable --> UI

    Collections --> Storage
    DB --> Plugins

    DB -.-> SyncEngine
    SyncEngine --> Transport
    SyncEngine --> Conflict
    Transport -.-> SyncServer
    SyncServer --> ServerDB
```

## Package Structure

Pocket is organized as a monorepo with 44 specialized packages:

```mermaid
graph TD
    subgraph Core["Core Packages"]
        core["@pocket/core"]
        sync["@pocket/sync"]
        pocket["pocket (all-in-one)"]
    end

    subgraph Frontend["Frontend Integration"]
        react["@pocket/react"]
        rn["@pocket/react-native"]
    end

    subgraph StorageAdapters["Storage Adapters"]
        idb["@pocket/storage-indexeddb"]
        opfs["@pocket/storage-opfs"]
        memory["@pocket/storage-memory"]
        sqlite["@pocket/storage-sqlite"]
    end

    subgraph ServerPkgs["Server"]
        server["@pocket/server"]
        syncserver["@pocket/sync-server"]
    end

    subgraph Extensions["Extensions"]
        ai["@pocket/ai"]
        vectors["@pocket/vectors"]
        crdt["@pocket/crdt"]
        encryption["@pocket/encryption"]
        devtools["@pocket/devtools"]
    end

    pocket --> core
    pocket --> react
    pocket --> idb

    react --> core
    rn --> core
    sync --> core

    server --> sync
    syncserver --> sync

    ai --> core
    ai --> vectors
    vectors --> core
    crdt --> core
    encryption --> core
    devtools --> core
```

### Package Categories

| Category | Packages | Description |
|----------|----------|-------------|
| **Core** | `@pocket/core`, `@pocket/sync`, `pocket` | Database engine, sync, and all-in-one bundle |
| **Frontend** | `@pocket/react`, `@pocket/react-native` | Framework integrations |
| **Storage** | `storage-indexeddb`, `storage-opfs`, `storage-memory`, `storage-sqlite` | Pluggable storage backends |
| **Server** | `@pocket/server`, `@pocket/sync-server` | Server-side sync infrastructure |
| **Data** | `@pocket/vectors`, `@pocket/crdt`, `@pocket/query` | Advanced data structures |
| **AI** | `@pocket/ai` | LLM integration with RAG pipeline |
| **Security** | `@pocket/encryption`, `@pocket/permissions` | Security and access control |
| **DX** | `@pocket/devtools`, `@pocket/time-travel` | Developer experience |
| **Features** | `@pocket/forms`, `@pocket/analytics`, `@pocket/presence`, `@pocket/cross-tab` | Application features |

## Core Components

### Database (`@pocket/core`)

The database is the central component that manages collections and coordinates operations.

```mermaid
classDiagram
    class Database {
        +name: string
        +storage: StorageAdapter
        +plugins: PluginManager
        +collection(name): Collection
        +close(): Promise
    }

    class Collection {
        +name: string
        +insert(doc): Promise
        +get(id): Promise
        +update(id, changes): Promise
        +delete(id): Promise
        +find(): QueryBuilder
        +find$(): Observable
    }

    class QueryBuilder {
        +where(field): FilterBuilder
        +sort(field, order): QueryBuilder
        +limit(n): QueryBuilder
        +skip(n): QueryBuilder
        +exec(): Promise
        +$: Observable
    }

    class StorageAdapter {
        <<interface>>
        +get(key): Promise
        +set(key, value): Promise
        +delete(key): Promise
        +query(options): Promise
    }

    Database "1" --> "*" Collection
    Collection --> QueryBuilder
    Collection --> StorageAdapter
```

### Core Module Structure

```
packages/core/src/
├── database/           # Database and Collection classes
│   ├── database.ts     # Main Database class
│   ├── collection.ts   # Collection with CRUD operations
│   └── document.ts     # Document utilities
├── query/              # Query engine
│   ├── query-builder.ts    # Fluent query API
│   ├── query-executor.ts   # Query execution
│   ├── query-planner.ts    # Query optimization
│   └── operators.ts        # Filter operators ($eq, $gt, etc.)
├── observable/         # Reactive system
│   ├── observable.ts   # Base observable utilities
│   ├── live-query.ts   # Live query subscriptions
│   └── event-reduce.ts # Event batching/debouncing
├── change-tracking/    # Change detection
│   ├── change-feed.ts  # Change event stream
│   └── vector-clock.ts # Causality tracking for sync
├── schema/             # Schema validation
│   └── schema.ts       # Zod-based validation
├── plugins/            # Plugin system
│   ├── plugin-manager.ts   # Plugin lifecycle
│   ├── middleware.ts       # Middleware chain
│   └── builtin/            # Built-in plugins
├── migrations/         # Schema migrations
│   ├── migration-manager.ts
│   └── migration-runner.ts
├── search/             # Full-text search
│   ├── search-index.ts # BM25 search index
│   └── tokenizer.ts    # Text tokenization
└── types/              # TypeScript types
    ├── document.ts
    ├── query.ts
    └── storage.ts
```

## Data Flow

### Read Path

```mermaid
sequenceDiagram
    participant App as Application
    participant Hook as useLiveQuery
    participant DB as Database
    participant Coll as Collection
    participant Query as QueryBuilder
    participant Store as Storage

    App->>Hook: useLiveQuery('todos')
    Hook->>DB: getCollection('todos')
    DB->>Coll: return collection
    Hook->>Coll: find().$
    Coll->>Query: create QueryBuilder
    Query->>Store: execute query
    Store-->>Query: documents[]
    Query-->>Hook: Observable<documents>
    Hook-->>App: { data, loading }

    Note over Store,App: On data change
    Store->>Query: change event
    Query->>Hook: updated documents
    Hook->>App: re-render
```

### Write Path

```mermaid
sequenceDiagram
    participant App as Application
    participant Coll as Collection
    participant Plugin as Plugins
    participant Store as Storage
    participant Change as ChangeFeed
    participant Sync as SyncEngine

    App->>Coll: insert(document)
    Coll->>Plugin: beforeInsert hooks
    Plugin-->>Coll: modified document
    Coll->>Store: persist document
    Store-->>Coll: success
    Coll->>Change: emit change event
    Coll->>Plugin: afterInsert hooks
    Change-->>App: notify subscribers

    opt Sync enabled
        Change->>Sync: queue change
        Sync->>Sync: batch changes
        Sync->>Server: push changes
    end
```

## Storage Layer

Pocket uses a pluggable storage adapter pattern:

```mermaid
graph LR
    subgraph StorageInterface["Storage Interface"]
        API[StorageAdapter]
    end

    subgraph Implementations["Implementations"]
        IDB[IndexedDB Adapter]
        OPFS[OPFS Adapter]
        Memory[Memory Adapter]
        SQLite[SQLite Adapter]
    end

    API --> IDB
    API --> OPFS
    API --> Memory
    API --> SQLite

    subgraph Platforms["Platform Support"]
        IDB --> Browser
        OPFS --> ModernBrowser["Modern Browsers"]
        Memory --> Testing
        SQLite --> Desktop["Desktop/Electron"]
    end
```

### Storage Adapter Interface

```typescript
interface StorageAdapter {
  // Document operations
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, doc: T): Promise<void>;
  delete(collection: string, id: string): Promise<void>;

  // Batch operations
  bulkGet<T>(collection: string, ids: string[]): Promise<T[]>;
  bulkSet<T>(collection: string, docs: T[]): Promise<void>;

  // Query operations
  query<T>(collection: string, options: QueryOptions): Promise<T[]>;
  count(collection: string, filter?: Filter): Promise<number>;

  // Index operations
  createIndex(collection: string, field: string): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
  clear(): Promise<void>;
}
```

### Choosing a Storage Backend

| Backend | Use Case | Pros | Cons |
|---------|----------|------|------|
| **IndexedDB** | Default for web | Universal browser support | Slower for large datasets |
| **OPFS** | Large datasets | Fast, file-system based | Limited browser support |
| **Memory** | Testing | Instant, no persistence | Data lost on refresh |
| **SQLite** | Desktop apps | SQL queries, fast | Requires native bindings |

## Sync Architecture

### Sync Protocol

```mermaid
sequenceDiagram
    participant Client as Client
    participant Engine as SyncEngine
    participant Transport as Transport
    participant Server as SyncServer
    participant DB as Server DB

    Note over Client,DB: Initial Sync
    Client->>Engine: start()
    Engine->>Transport: connect
    Transport->>Server: WebSocket/HTTP
    Engine->>Server: pull(checkpoint)
    Server->>DB: get changes since checkpoint
    DB-->>Server: changes[]
    Server-->>Engine: changes + new checkpoint
    Engine->>Client: apply changes

    Note over Client,DB: Push Changes
    Client->>Engine: local change
    Engine->>Engine: add to outbox
    Engine->>Server: push(changes[])
    Server->>Server: resolve conflicts
    Server->>DB: persist
    Server-->>Engine: ack + resolved changes
    Engine->>Client: apply resolutions
```

### Conflict Resolution

```mermaid
flowchart TD
    A[Change Detected] --> B{Same Document?}
    B -->|No| C[Apply Both]
    B -->|Yes| D{Resolution Strategy}

    D -->|Last Write Wins| E[Compare Timestamps]
    D -->|Merge| F[Deep Merge Fields]
    D -->|Custom| G[User Resolver]

    E --> H[Keep Newer]
    F --> I[Combined Document]
    G --> J[User Decision]

    H --> K[Apply & Notify]
    I --> K
    J --> K
```

### Sync Module Structure

```
packages/sync/src/
├── sync-engine.ts      # Main sync coordinator
├── checkpoint.ts       # Checkpoint management
├── conflict.ts         # Conflict detection & resolution
├── optimistic.ts       # Optimistic updates
├── rollback.ts         # Rollback on sync failure
├── logger.ts           # Sync logging
├── transport/          # Transport layer
│   ├── types.ts        # Transport interface
│   ├── http.ts         # HTTP transport
│   └── websocket.ts    # WebSocket transport
└── selective/          # Selective sync
    ├── types.ts
    ├── filter-evaluator.ts
    └── selective-sync-manager.ts
```

## Extension System

### Plugin Architecture

```mermaid
graph TD
    subgraph PluginSystem["Plugin System"]
        PM[PluginManager]
        MW[Middleware Chain]
    end

    subgraph Hooks["Lifecycle Hooks"]
        BI[beforeInsert]
        AI[afterInsert]
        BU[beforeUpdate]
        AU[afterUpdate]
        BD[beforeDelete]
        AD[afterDelete]
        BQ[beforeQuery]
        AQ[afterQuery]
    end

    subgraph BuiltIn["Built-in Plugins"]
        TS[Timestamps]
        SD[Soft Delete]
        AL[Audit Log]
        CF[Computed Fields]
    end

    PM --> MW
    MW --> Hooks
    BuiltIn --> PM
```

### Creating a Plugin

```typescript
import { Plugin, PluginContext } from '@pocket/core';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  install(context: PluginContext) {
    // Register hooks
    context.hooks.beforeInsert(async (doc, collection) => {
      return { ...doc, createdBy: getCurrentUser() };
    });

    context.hooks.afterUpdate(async (doc, collection) => {
      await logAuditEvent('update', doc);
    });
  },

  uninstall(context: PluginContext) {
    // Cleanup
  }
};
```

### Extension Packages

| Package | Purpose | Key Features |
|---------|---------|--------------|
| **@pocket/ai** | LLM Integration | RAG pipeline, embeddings, chat |
| **@pocket/vectors** | Vector Search | HNSW index, similarity search |
| **@pocket/crdt** | Collaboration | Conflict-free data types |
| **@pocket/encryption** | Security | E2E encryption, key management |
| **@pocket/permissions** | Access Control | Row-level security |
| **@pocket/devtools** | Debugging | Inspector, query profiler |
| **@pocket/time-travel** | History | Undo/redo, snapshots |
| **@pocket/presence** | Real-time | User presence, cursors |
| **@pocket/cross-tab** | Multi-tab | Cross-tab sync |
| **@pocket/forms** | UI Generation | Schema-driven forms |
| **@pocket/analytics** | Tracking | Offline analytics |

## Design Decisions

For detailed rationale behind major architectural decisions, see our [Architecture Decision Records (ADRs)](/docs/adr/):

1. **[ADR-001: Local-First Architecture](/docs/adr/001-local-first.md)** - Why data lives on the client first
2. **[ADR-002: RxJS for Reactivity](/docs/adr/002-rxjs-reactivity.md)** - Choosing RxJS for the reactive system
3. **[ADR-003: Pluggable Storage](/docs/adr/003-pluggable-storage.md)** - Storage adapter pattern
4. **[ADR-004: Vector Clocks for Sync](/docs/adr/004-vector-clocks.md)** - Causality tracking in sync
5. **[ADR-005: Monorepo Structure](/docs/adr/005-monorepo.md)** - Package organization

### Key Design Principles

1. **Separation of Concerns** - Each package has a single responsibility
2. **Dependency Inversion** - Core depends on interfaces, not implementations
3. **Progressive Enhancement** - Start simple, add features as needed
4. **Type Safety** - TypeScript throughout, generics for collections
5. **Tree Shaking** - Import only what you use
6. **Testability** - Memory storage for easy testing

## See Also

- [Getting Started](/docs/intro) - Quick start guide
- [API Reference](/docs/api/database) - Complete API documentation
- [Contributing](/CONTRIBUTING.md) - How to contribute
- [Development Guide](/DEVELOPMENT.md) - Development setup
