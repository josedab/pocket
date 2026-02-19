# ADR-004: Vector Clocks for Sync

## Status

Accepted

## Context

When multiple clients modify the same document, we need to:
1. Detect conflicts (concurrent modifications)
2. Determine causal ordering (which change came after which)
3. Resolve conflicts consistently across all clients

Simple approaches have problems:
- **Timestamps**: Clock drift, can't detect true concurrency
- **Version numbers**: Don't capture causality, prone to lost updates
- **Last-write-wins only**: Loses data silently

## Decision

Use vector clocks to track document causality and detect conflicts.

### Document Structure

```typescript
interface Document {
  _id: string;
  _rev: number;
  _clock: VectorClock;  // { [nodeId]: counter }
  _updatedAt: number;
}

// Example vector clock
{
  "client-a": 3,
  "client-b": 2,
  "server": 5
}
```

### How Vector Clocks Work

Each client/server has a unique node ID. When a document is modified:

1. Increment the counter for the local node
2. Include all known counters from other nodes

```typescript
// Client A updates document
// Before: { "client-a": 2, "client-b": 1 }
// After:  { "client-a": 3, "client-b": 1 }

// Client B updates same document concurrently
// Before: { "client-a": 2, "client-b": 1 }
// After:  { "client-a": 2, "client-b": 2 }
```

### Conflict Detection

Compare two vector clocks to determine relationship:

```typescript
function compareClocks(a: VectorClock, b: VectorClock): 'before' | 'after' | 'concurrent' {
  let aBeforeB = false;
  let bBeforeA = false;

  for (const node of allNodes(a, b)) {
    const aVal = a[node] ?? 0;
    const bVal = b[node] ?? 0;

    if (aVal < bVal) aBeforeB = true;
    if (bVal < aVal) bBeforeA = true;
  }

  if (aBeforeB && !bBeforeA) return 'before';
  if (bBeforeA && !aBeforeB) return 'after';
  return 'concurrent'; // CONFLICT!
}
```

### Example Scenario

```
Client A                    Client B
   │                           │
   │ clock: {a:1}              │ clock: {a:1}
   │                           │
   ├── update (a:2) ───────────┤
   │                           ├── update (b:1)
   │                           │
   │                    Both send to server
   │                           │
   │                    Server detects:
   │                    {a:2} vs {a:1,b:1}
   │                    Neither dominates = CONFLICT
```

## Consequences

### Positive

- **True conflict detection**: Identifies actual concurrent modifications
- **Causality tracking**: Knows which changes happened before others
- **No clock sync needed**: Doesn't depend on synchronized time
- **Distributed-friendly**: No central authority required
- **Correct merging**: Can merge non-conflicting concurrent changes

### Negative

- **Storage overhead**: Vector clocks grow with number of clients
- **Complexity**: More complex than simple timestamps
- **Garbage collection**: Old entries need pruning

### Mitigations

1. **Clock pruning**: Remove entries from inactive nodes periodically
2. **Compression**: Only store non-zero entries
3. **Hybrid approach**: Use Hybrid Logical Clocks for ordering within conflicts

## Implementation Details

### Merging Clocks

When receiving a remote change:

```typescript
function mergeClock(local: VectorClock, remote: VectorClock): VectorClock {
  const merged: VectorClock = { ...local };

  for (const [node, counter] of Object.entries(remote)) {
    merged[node] = Math.max(merged[node] ?? 0, counter);
  }

  return merged;
}
```

### Incrementing on Update

```typescript
function incrementClock(clock: VectorClock, nodeId: string): VectorClock {
  return {
    ...clock,
    [nodeId]: (clock[nodeId] ?? 0) + 1,
  };
}
```

## Alternatives Considered

### 1. Timestamps Only

Use `_updatedAt` timestamp for conflict resolution.

Rejected because:
- Clock drift between clients causes incorrect ordering
- Can't detect true concurrency
- Requires synchronized clocks

### 2. Lamport Clocks

Single counter incremented on each event.

```typescript
interface Document {
  _counter: number;
}
```

Rejected because:
- Can't detect concurrent modifications
- Only provides total ordering, not causality

### 3. CRDTs

Use Conflict-free Replicated Data Types for all data.

Rejected because:
- Overkill for document-level sync
- Complex to implement for arbitrary JSON
- Memory overhead for operation history

### 4. Operational Transform

Transform concurrent operations for consistent merging.

Rejected because:
- Very complex to implement correctly
- Better suited for real-time text editing
- Overkill for document databases

## References

- [Vector Clocks Revisited](https://riak.com/posts/technical/vector-clocks-revisited/)
- [Time, Clocks, and the Ordering of Events in a Distributed System](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) - Leslie Lamport
- [Dynamo: Amazon's Highly Available Key-value Store](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
