# ADR-001: Local-First Architecture

## Status

Accepted

## Context

Modern web applications need to work reliably regardless of network conditions. Users expect:
- Instant responses without loading spinners
- Ability to work offline
- Data persistence across sessions
- Real-time collaboration when online

Traditional client-server architectures fail these requirements because:
- Every operation requires a network round-trip
- Offline mode is an afterthought, often poorly implemented
- Network failures result in errors or lost data
- Latency varies widely based on connection quality

## Decision

Pocket will be built as a local-first database, meaning:

1. **Data lives on the client first**
   - All data is stored locally using browser storage APIs
   - Operations complete instantly against local storage
   - No network required for basic CRUD operations

2. **Sync is optional and additive**
   - Applications work fully offline by default
   - Sync can be enabled per-collection when needed
   - Network failures don't break the application

3. **Optimistic updates**
   - Changes are applied locally immediately
   - Sync happens in the background
   - Conflicts are resolved automatically or with user input

4. **Eventual consistency**
   - Multiple clients may have temporarily different views
   - The system converges to a consistent state over time
   - CRDTs and vector clocks enable conflict-free merging

## Consequences

### Positive

- **Instant responsiveness**: UI updates immediately, no network wait
- **Offline capability**: Full functionality without internet
- **Resilience**: Network issues don't cause data loss or errors
- **Reduced server load**: Fewer requests, less bandwidth
- **Better UX**: No spinners, optimistic updates

### Negative

- **Complexity**: Sync and conflict resolution add implementation complexity
- **Storage limits**: Browser storage has limits (~50MB-2GB)
- **Data consistency**: Eventual consistency may confuse some use cases
- **Security**: Sensitive data stored client-side needs consideration

### Neutral

- **Different mental model**: Developers used to REST/GraphQL need to adapt
- **Testing**: Need to test offline scenarios and sync conflicts

## Alternatives Considered

### 1. Traditional Client-Server

Store all data on server, fetch on demand.

Rejected because: Poor offline experience, latency issues, requires constant connectivity.

### 2. Cache-First with Network Fallback

Use service workers to cache API responses.

Rejected because: Doesn't handle offline writes, complex cache invalidation, not a true database.

### 3. Full Offline Database (No Sync)

Local-only database like Dexie.js without sync capabilities.

Rejected because: Modern apps need multi-device sync and collaboration.

## References

- [Local-First Software](https://www.inkandswitch.com/local-first/) - Ink & Switch
- [CRDTs and the Quest for Distributed Consistency](https://www.youtube.com/watch?v=B5NULPSiOGw)
- [Designing Data-Intensive Applications](https://dataintensive.net/) - Martin Kleppmann
