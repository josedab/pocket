# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release of Pocket database
- Core database engine with collection support
- IndexedDB storage adapter
- OPFS storage adapter
- Memory storage adapter
- React hooks integration (`@pocket/react`)
- Sync engine with WebSocket and HTTP support (`@pocket/sync`)
- Server-side sync endpoint (`@pocket/server`)
- Comprehensive documentation site

### Core Features
- Local-first architecture with offline support
- Reactive queries using RxJS observables
- Type-safe query builder with fluent API
- Schema validation with defaults
- Automatic timestamps and revision tracking
- Vector clocks for conflict detection

### Query Capabilities
- Comparison operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`
- String operators: `startsWith`, `endsWith`, `contains`, `matches`
- Array operators: `in`, `notIn`, `all`, `size`, `elemMatch`
- Logical operators: `and`, `or`
- Sorting, pagination, and projection

### React Integration
- `PocketProvider` context provider
- `useLiveQuery` hook for reactive queries
- `useQuery` simplified query hook
- `useCollection` direct collection access
- `useDatabase` database instance access

### Sync Features
- Bidirectional sync (push/pull)
- WebSocket real-time updates
- HTTP polling fallback
- Conflict resolution strategies
- Optimistic updates
- Offline queue

### Storage Adapters
- IndexedDB for persistent browser storage
- OPFS for high-performance file storage
- Memory adapter for testing

---

## Version History

### Versioning Policy

- **Major (1.0.0)**: Breaking API changes
- **Minor (0.1.0)**: New features, backward compatible
- **Patch (0.0.1)**: Bug fixes, backward compatible

### Migration Guides

Migration guides for major versions will be documented here.

---

## Contributing

When making changes, please update this changelog:

1. Add entries under `[Unreleased]`
2. Group changes by type: Added, Changed, Deprecated, Removed, Fixed, Security
3. Include issue/PR references where applicable
4. Keep entries concise but descriptive

Example entry:
```markdown
### Fixed
- Query builder now correctly handles null values in filters (#123)
```

[Unreleased]: https://github.com/pocket-db/pocket/compare/main...HEAD
