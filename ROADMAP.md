# Pocket Roadmap

This document outlines the development roadmap for Pocket. It is a living document and will be updated as priorities evolve.

## Version 1.0 (Stable Release)

**Target**: Production-ready local-first database with sync capabilities

### Core Features (Complete)

- [x] Core database engine with CRUD operations
- [x] Reactive queries with RxJS
- [x] Multiple storage backends (IndexedDB, OPFS, Memory)
- [x] Schema validation with defaults
- [x] TypeScript-first with strict typing
- [x] React bindings with hooks
- [x] Sync engine with conflict resolution
- [x] Vector clock support for distributed systems

### Pre-1.0 Requirements (In Progress)

- [ ] **Security hardening**
  - [x] Safe regex pattern handling (ReDoS prevention)
  - [x] Vector clock validation
  - [ ] Auth token secure storage recommendations
  - [ ] Input sanitization documentation

- [ ] **Testing improvements**
  - [ ] Error path test coverage
  - [ ] Concurrency/race condition tests
  - [ ] Performance benchmarks
  - [ ] Sync engine edge case tests

- [ ] **Documentation**
  - [ ] FAQ and troubleshooting guide
  - [ ] Migration guide template
  - [ ] Performance optimization guide
  - [ ] Advanced sync patterns

- [ ] **Observability**
  - [ ] Structured logging in sync engine
  - [ ] Retry metrics and monitoring hooks
  - [ ] Debug mode with verbose output

## Version 1.1 (Post-Stable)

### Planned Features

- [ ] **SQLite storage adapter**
  - Desktop/Electron support
  - Better query performance for large datasets
  - Cross-platform consistency

- [ ] **Enhanced React integration**
  - Connection status hook (`useSyncStatus`)
  - Optimistic update hooks
  - Suspense support

- [ ] **Performance optimizations**
  - Query result caching
  - Lazy loading for large collections
  - Index hints and query planning

## Version 1.2

### Potential Features

- [ ] **End-to-end encryption**
  - Client-side encryption option
  - Key management utilities
  - Encrypted sync protocol

- [ ] **Plugin/middleware system**
  - Pre/post hooks for operations
  - Custom validation middleware
  - Audit logging plugins

- [ ] **GraphQL integration**
  - GraphQL resolvers for collections
  - Subscription support
  - Schema generation

## Future Exploration

These features are being evaluated for potential inclusion:

### Platform Expansion

- **React Native adapter** - Mobile-first storage with native optimizations
- **Deno/Bun compatibility** - Modern runtime support
- **Edge deployment** - Cloudflare Workers, Deno Deploy support

### Advanced Sync

- **CRDT support** - Real-time collaboration with conflict-free data types
- **Partial sync** - Sync only specific collections or documents
- **Offline-first mutations** - Queue operations for later sync

### Developer Experience

- **DevTools extension** - Browser extension for debugging
- **CLI tools** - Database inspection and migration utilities
- **VS Code extension** - Schema validation and autocomplete

## Contributing to the Roadmap

We welcome community input on the roadmap. To suggest features or changes:

1. **Open a Discussion**: Use [GitHub Discussions](https://github.com/pocket-db/pocket/discussions/categories/ideas) for feature ideas
2. **Submit an RFC**: For significant features, submit a detailed proposal as an issue
3. **Vote on existing ideas**: Add reactions to features you want to see prioritized

## Versioning Policy

Pocket follows [Semantic Versioning](https://semver.org/):

- **Major versions** (1.0, 2.0): Breaking changes to public API
- **Minor versions** (1.1, 1.2): New features, backwards compatible
- **Patch versions** (1.0.1, 1.0.2): Bug fixes, security updates

## Timeline

We do not provide specific dates for releases. Features are released when they meet our quality standards. Track progress through:

- [GitHub Milestones](https://github.com/pocket-db/pocket/milestones)
- [Project Board](https://github.com/pocket-db/pocket/projects)
- [CHANGELOG](./CHANGELOG.md)
