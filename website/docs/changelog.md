---
sidebar_position: 100
title: Changelog
description: Release notes and version history
---

# Changelog

All notable changes to Pocket are documented on this page.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

:::tip Stay Updated
Subscribe to [GitHub releases](https://github.com/pocket-db/pocket/releases) to get notified about new versions.
:::

---

## [Unreleased]

### Added

- Selective sync guide with comprehensive documentation
- CRDTs guide with collaboration patterns
- Encryption guide with security best practices
- React Native guide with mobile storage adapters
- Vectors & AI integration guide with RAG pipeline
- Full-text search guide with BM25 scoring
- Plugin system guide with middleware patterns
- Schema migrations guide with rollback support

---

## [0.7.0] - 2025-01

> **Highlights**: AI integration with RAG pipelines, advanced conflict resolution strategies, and high-performance vector storage.

| Package | Version |
|---------|---------|
| `pocket` | 0.7.0 |
| `@pocket/core` | 0.7.0 |
| `@pocket/sync` | 0.7.0 |
| `@pocket/react` | 0.7.0 |
| `@pocket/vectors` | 0.7.0 |
| `@pocket/ai` | 0.7.0 |

### Added

#### Conflict Resolution
- Advanced sync conflict handling with pluggable strategies
- Last-writer-wins, merge, and custom resolution strategies
- Conflict history tracking and audit logs
- Automatic and manual conflict resolution modes

#### AI Integration
- RAG (Retrieval-Augmented Generation) pipeline
- AI assistants with conversation history
- Support for OpenAI, Anthropic, and Ollama
- Streaming responses and tool calling

#### Vector Storage
- High-performance vector storage with similarity search
- Flat and HNSW index types
- Multiple distance metrics (cosine, euclidean, dot product)
- Embedding providers: OpenAI, Cohere, Ollama

### Changed

- Improved sync performance with batched operations
- Enhanced TypeScript types for better inference
- Updated RxJS dependency to version 7.8

### Fixed

- WebSocket reconnection handling in sync server
- Memory leak in reactive query subscriptions
- Type errors in generic collection methods

---

## [0.6.0] - 2024-12

> **Highlights**: Real-time sync server with WebSocket support, time-travel debugging, and row-level security.

| Package | Version |
|---------|---------|
| `pocket` | 0.6.0 |
| `@pocket/core` | 0.6.0 |
| `@pocket/sync` | 0.6.0 |
| `@pocket/server` | 0.6.0 |
| `@pocket/time-travel` | 0.6.0 |

### Added

#### Sync Server
- WebSocket-based real-time sync server
- Connection pooling and automatic reconnection
- Presence and awareness protocol
- Server-side conflict resolution

#### Time Travel
- Undo/redo functionality with operation history
- State snapshots and restoration
- Time-travel debugging support

#### Analytics
- Usage metrics and performance tracking
- Query performance monitoring
- Storage usage analytics

#### Permissions
- Row-level security for document access
- Role-based access control (RBAC)
- Custom permission validators

### Changed

- Refactored sync engine for better extensibility
- Improved error messages and stack traces

---

## [0.5.0] - 2024-11

> **Highlights**: Schema-driven form generation, real-time presence system, and cross-tab synchronization.

### Added

#### Form Generation
- Schema-driven form generation
- Automatic validation from Zod schemas
- Field-level reactivity
- Custom field renderers

#### Reactive Queries
- Live query subscriptions with RxJS
- Automatic re-execution on data changes
- Query result caching

#### Presence System
- Real-time user presence tracking
- Cursor and selection sharing
- Custom presence metadata

#### Cross-Tab Sync
- Automatic synchronization across browser tabs
- Shared state management
- Tab leader election

### Changed

- Enhanced query builder with more operators
- Improved collection type inference

---

## [0.4.0] - 2024-10

> **Highlights**: React Native support with native storage adapters, browser DevTools extension, and end-to-end encryption.

### Added

#### React Native
- React Native adapter with native storage
- AsyncStorage and MMKV adapters
- Optimized hooks for mobile
- App state and network handling

#### DevTools
- Browser extension for debugging
- Query inspector and profiler
- Document viewer and editor
- Sync status monitoring

#### SQLite Storage
- SQLite storage adapter for React Native
- Better-sqlite3 adapter for Node.js
- SQL-based query optimization

#### End-to-End Encryption
- AES-256 encryption (GCM and CBC modes)
- PBKDF2 key derivation
- Field-level encryption
- Key rotation support

### Changed

- Standardized storage adapter interface
- Improved React hook performance

---

## [0.3.0] - 2024-09

> **Highlights**: CRDT support for conflict-free collaboration and selective sync with document filters.

### Added

#### CRDT Support
- Conflict-free replicated data types
- G-Counter and PN-Counter
- LWW-Register and MV-Register
- G-Set and OR-Set
- LWW-Map
- JSON CRDT for document collaboration

#### Selective Sync
- Partial data synchronization
- Document filters with query operators
- Time-based sync filters
- Field projections (include/exclude)
- Sync policies with named rules

### Changed

- Improved vector clock implementation
- Better merge algorithm for documents

---

## [0.2.0] - 2024-08

> **Highlights**: Full-text search with BM25 scoring, plugin system with lifecycle hooks, and schema migrations.

### Added

#### Full-Text Search
- Built-in search index
- BM25 relevance scoring
- Porter stemming
- Fuzzy matching
- Search highlighting
- Auto-complete suggestions

#### Plugin System
- Middleware architecture
- Lifecycle hooks (beforeInsert, afterUpdate, etc.)
- Plugin composition
- Built-in plugins: timestamps, soft delete

#### Schema Migrations
- Version-based migrations
- Up/down migration functions
- Lazy migrations
- Progress tracking
- Rollback support

### Changed

- Refactored core database internals
- Improved TypeScript generics

---

## [0.1.0] - 2024-07

> **Initial Release**: Local-first database with reactive queries, React hooks, IndexedDB/OPFS storage, and basic sync.

### Added

#### Core Database
- Document-based storage with collections
- CRUD operations (insert, get, update, delete)
- Reactive queries with RxJS
- Transaction support

#### Storage Backends
- IndexedDB storage adapter
- OPFS (Origin Private File System) adapter
- In-memory adapter for testing

#### Query Builder
- Fluent query API
- Field comparisons ($eq, $ne, $gt, $lt, etc.)
- Array operators ($in, $nin)
- Logical operators ($and, $or, $not)
- Sorting, limiting, pagination

#### React Integration
- React hooks (useDocument, useQuery, useMutation)
- PocketProvider context
- Optimistic updates
- Suspense support

#### Basic Sync
- Push/pull synchronization
- Checkpoint-based sync
- Offline queue management
- Conflict detection

#### Schema Validation
- Zod schema integration
- Runtime validation
- Type inference from schemas

#### Indexing
- Secondary indexes on fields
- Compound indexes
- Unique constraints
- Index-based query optimization

### Documentation

- Getting started guide
- API reference
- Core concepts
- React integration guide
- Sync setup guide

---

## Migration Guides

### Upgrading to 0.7.0

No breaking changes. New features are opt-in.

### Upgrading to 0.6.0

The sync engine configuration has changed:

```typescript
// Before
const sync = createSyncEngine(db, 'wss://server.com');

// After
const sync = createSyncEngine(db, {
  serverUrl: 'wss://server.com',
  // New optional configuration
  reconnect: true,
  reconnectDelay: 1000,
});
```

### Upgrading to 0.5.0

React hooks now require the `PocketProvider`:

```tsx
// Wrap your app with PocketProvider
<PocketProvider database={db}>
  <App />
</PocketProvider>
```

---

## Deprecation Notices

### 0.7.0

- `db.sync()` is deprecated. Use `createSyncEngine()` instead.
- `collection.watch()` is deprecated. Use `collection.find().$.subscribe()` instead.

---

## Roadmap

See our [GitHub Discussions](https://github.com/pocket-db/pocket/discussions) for upcoming features and to vote on priorities.

### Planned for 0.8.0

- [ ] GraphQL adapter
- [ ] Replication protocol improvements
- [ ] Multi-tenant support
- [ ] Server-side rendering (SSR) improvements

### Under Consideration

- [ ] PouchDB compatibility layer
- [ ] SQLite WASM in browser
- [ ] WebRTC peer-to-peer sync
- [ ] Deno and Bun support
