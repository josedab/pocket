# Universal Sync Protocol (USP) v1.0 — Specification

> **Status**: Draft  
> **Package**: `@pocket/sync-protocol`  
> **Version**: 1.0.0  
> **Authors**: Pocket Contributors

## Abstract

The Universal Sync Protocol (USP) defines a standard wire protocol for bidirectional synchronization between local-first databases and servers. Any client or server implementing USP can interoperate, regardless of programming language or database engine.

USP provides:
- **Handshake and authentication** for establishing sync sessions
- **Push/pull semantics** for bidirectional change propagation
- **Vector clock-based conflict detection** for distributed causality
- **Pluggable conflict resolution** strategies
- **Capability negotiation** for extensibility

## Motivation

Local-first databases need synchronization, but every implementation invents its own sync protocol. This creates vendor lock-in and prevents interoperability. USP standardizes the sync layer so that:

1. Clients built with Pocket can sync with any USP-compliant server
2. Servers can be implemented in any language (Node.js, Python, Go, Rust)
3. Migration between sync providers requires no client-side changes
4. The protocol is formally specified with a conformance test suite

## Protocol Overview

```
┌──────────────┐                    ┌──────────────┐
│    Client    │                    │    Server    │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │  ── handshake ──────────────────► │
       │  ◄─ handshake-ack ──────────────  │
       │                                   │
       │  ── push (local changes) ───────► │
       │  ◄─ push-ack ──────────────────── │
       │                                   │
       │  ── pull (checkpoint) ──────────► │
       │  ◄─ pull-response (changes) ──── │
       │                                   │
       │  ── ping ───────────────────────► │
       │  ◄─ pong ────────────────────────│
       │                                   │
```

## 1. Message Envelope

Every USP message is a JSON object with these required fields:

| Field | Type | Description |
|-------|------|-------------|
| `protocol` | `"usp"` | Protocol identifier (always `"usp"`) |
| `version` | `string` | Protocol version (e.g., `"1.0.0"`) |
| `type` | `string` | Message type (see §2) |
| `id` | `string` | Unique message identifier for correlation |
| `timestamp` | `number` | Unix timestamp in milliseconds |

```json
{
  "protocol": "usp",
  "version": "1.0.0",
  "type": "handshake",
  "id": "msg-001",
  "timestamp": 1708000000000
}
```

## 2. Message Types

USP defines 9 message types:

| Type | Direction | Purpose |
|------|-----------|---------|
| `handshake` | Client → Server | Initiate sync session |
| `handshake-ack` | Server → Client | Acknowledge and configure session |
| `push` | Client → Server | Send local changes to server |
| `push-ack` | Server → Client | Acknowledge or reject changes |
| `pull` | Client → Server | Request changes since checkpoint |
| `pull-response` | Server → Client | Return changes and new checkpoint |
| `ping` | Either → Either | Keepalive probe |
| `pong` | Either → Either | Keepalive response |
| `error` | Either → Either | Error notification |

## 3. Handshake

### 3.1 Client Request

The client initiates a sync session by sending a `handshake` message:

```json
{
  "protocol": "usp",
  "version": "1.0.0",
  "type": "handshake",
  "id": "hs-001",
  "timestamp": 1708000000000,
  "payload": {
    "nodeId": "client-abc123",
    "collections": ["todos", "notes"],
    "checkpoint": "cp-previous-session",
    "capabilities": ["push", "pull", "realtime"],
    "auth": {
      "type": "bearer",
      "token": "eyJhbGci..."
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `nodeId` | Yes | Globally unique client identifier |
| `collections` | Yes | Collections the client wants to sync |
| `checkpoint` | No | Resume token from a previous session |
| `capabilities` | Yes | Capabilities the client supports |
| `auth` | No | Authentication credentials |

### 3.2 Server Response

```json
{
  "protocol": "usp",
  "version": "1.0.0",
  "type": "handshake-ack",
  "id": "hs-ack-001",
  "timestamp": 1708000000001,
  "payload": {
    "sessionId": "sess-xyz789",
    "serverNodeId": "server-region-us-1",
    "acceptedCollections": ["todos", "notes"],
    "serverCapabilities": ["push", "pull", "compression"],
    "checkpoint": "cp-server-current"
  }
}
```

The server MAY reject collections by omitting them from `acceptedCollections`. The server MUST return a `checkpoint` that the client can use for subsequent `pull` requests.

## 4. Change Records

A change record represents a single document mutation:

```json
{
  "collection": "todos",
  "documentId": "doc-001",
  "operation": "update",
  "document": {
    "_id": "doc-001",
    "_rev": "3-abc",
    "_updatedAt": 1708000000000,
    "title": "Buy groceries",
    "completed": true
  },
  "timestamp": 1708000000000,
  "nodeId": "client-abc123",
  "vclock": {
    "client-abc123": 3,
    "server-region-us-1": 2
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `collection` | Yes | Target collection name |
| `documentId` | Yes | Document identifier |
| `operation` | Yes | One of: `insert`, `update`, `delete` |
| `document` | For insert/update | Full document with metadata |
| `timestamp` | Yes | When the change occurred |
| `nodeId` | Yes | Node that originated the change |
| `vclock` | Yes | Vector clock at time of change |

### 4.1 Document Metadata

Synced documents MUST include these metadata fields:

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `string` | Document identifier |
| `_rev` | `string` | Revision identifier (format: `{counter}-{hash}`) |
| `_updatedAt` | `number` | Last update timestamp |
| `_deleted` | `boolean` | Tombstone flag (optional) |
| `_vclock` | `object` | Vector clock (optional, for conflict detection) |

### 4.2 Vector Clocks

Vector clocks track causality across distributed nodes:

```json
{
  "client-abc123": 5,
  "client-def456": 3,
  "server-us-1": 10
}
```

**Comparison rules:**
- Clock A **happens-before** B if all entries in A are ≤ corresponding entries in B, and at least one is strictly less
- Clocks are **concurrent** if neither happens-before the other
- **Merge**: take the maximum of each entry

## 5. Push (Client → Server)

### 5.1 Push Request

```json
{
  "type": "push",
  "payload": {
    "sessionId": "sess-xyz789",
    "changes": [/* array of ChangeRecord */],
    "checkpoint": "cp-client-current"
  }
}
```

### 5.2 Push Acknowledgment

```json
{
  "type": "push-ack",
  "payload": {
    "sessionId": "sess-xyz789",
    "accepted": ["doc-001", "doc-003"],
    "rejected": [
      {
        "documentId": "doc-002",
        "reason": "conflict",
        "serverVersion": {/* ChangeRecord of server's version */}
      }
    ],
    "checkpoint": "cp-server-after-push"
  }
}
```

The server MUST return:
- `accepted`: Document IDs successfully persisted
- `rejected`: Document IDs that could not be accepted, with reason and optionally the server's conflicting version
- `checkpoint`: Updated checkpoint for the client

## 6. Pull (Server → Client)

### 6.1 Pull Request

```json
{
  "type": "pull",
  "payload": {
    "sessionId": "sess-xyz789",
    "checkpoint": "cp-last-known",
    "collections": ["todos"],
    "limit": 100
  }
}
```

### 6.2 Pull Response

```json
{
  "type": "pull-response",
  "payload": {
    "sessionId": "sess-xyz789",
    "changes": [/* array of ChangeRecord */],
    "checkpoint": "cp-server-current",
    "hasMore": false
  }
}
```

If `hasMore` is `true`, the client SHOULD issue another `pull` with the returned `checkpoint` to fetch remaining changes.

## 7. Conflict Resolution

When concurrent changes to the same document are detected (via vector clock comparison), the server applies a conflict resolution strategy.

### 7.1 Strategies

| Strategy | Behavior |
|----------|----------|
| `server-wins` | Server's version is kept; client is notified |
| `client-wins` | Client's version is accepted |
| `last-write-wins` | Version with higher timestamp wins |
| `merge` | Fields are deep-merged; server decides ties |
| `custom` | Application-defined resolver function |

### 7.2 Conflict Detection

Two changes are concurrent when their vector clocks are incomparable:

```
Client clock: { client: 5, server: 3 }
Server clock: { client: 4, server: 4 }
→ Neither happens-before the other → CONCURRENT → CONFLICT
```

## 8. Error Handling

### 8.1 Error Message

```json
{
  "type": "error",
  "payload": {
    "code": "AUTH_FAILED",
    "message": "Invalid or expired token",
    "retryable": false,
    "relatedMessageId": "hs-001"
  }
}
```

### 8.2 Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `AUTH_FAILED` | Authentication failed | No |
| `SESSION_EXPIRED` | Session no longer valid | Yes (re-handshake) |
| `COLLECTION_NOT_FOUND` | Unknown collection | No |
| `CONFLICT` | Unresolvable conflict | No |
| `QUOTA_EXCEEDED` | Usage quota exceeded | Yes (after wait) |
| `RATE_LIMITED` | Too many requests | Yes (after backoff) |
| `INVALID_MESSAGE` | Malformed message | No |
| `INTERNAL_ERROR` | Server error | Yes |
| `VERSION_MISMATCH` | Incompatible protocol version | No |

## 9. Capabilities

Clients and servers advertise capabilities during handshake:

| Capability | Description |
|------------|-------------|
| `push` | Can send changes |
| `pull` | Can receive changes |
| `realtime` | Supports WebSocket real-time push |
| `selective-sync` | Supports collection/document filtering |
| `compression` | Supports message compression |
| `e2e-encryption` | Supports end-to-end encryption |
| `crdt` | Supports CRDT-based conflict resolution |
| `binary-transport` | Supports binary (non-JSON) transport |

## 10. Transport

USP is transport-agnostic. Implementations SHOULD support:

1. **WebSocket** — Primary transport for real-time sync
2. **HTTP** — Fallback for environments without WebSocket

### 10.1 WebSocket Transport

Messages are sent as JSON text frames. The connection lifecycle:

1. Client opens WebSocket connection
2. Client sends `handshake` message
3. Server responds with `handshake-ack`
4. Bidirectional message exchange
5. Either side sends `ping`/`pong` for keepalive
6. Connection closes gracefully or on error

### 10.2 HTTP Transport

Each message pair maps to an HTTP request/response:

| USP Message | HTTP Method | Path |
|-------------|-------------|------|
| `handshake` | `POST` | `/usp/handshake` |
| `push` | `POST` | `/usp/push` |
| `pull` | `POST` | `/usp/pull` |
| `ping` | `GET` | `/usp/ping` |

## 11. Conformance

A USP implementation is **conformant** if it:

1. Accepts valid `handshake` messages and returns `handshake-ack`
2. Accepts valid `push` messages and returns `push-ack`
3. Returns changes in response to valid `pull` messages
4. Responds to `ping` with `pong`
5. Returns `error` for malformed messages
6. Includes valid message envelopes in all responses
7. Passes the `@pocket/sync-protocol` conformance test suite

### 11.1 Conformance Testing

```typescript
import { createConformanceSuite } from '@pocket/sync-protocol';

const suite = createConformanceSuite(myServerAdapter);
const report = await suite.runAll();

if (report.compliant) {
  console.log('✅ Server is USP-compliant');
} else {
  console.log(`❌ ${report.failed} conformance tests failed`);
}
```

## 12. Security Considerations

- All USP connections SHOULD use TLS (WSS/HTTPS)
- Authentication tokens MUST be transmitted only over encrypted connections
- Servers SHOULD implement rate limiting (error code `RATE_LIMITED`)
- Vector clocks SHOULD be validated to prevent clock manipulation
- Document content MAY be end-to-end encrypted (capability `e2e-encryption`)

## Appendix A: TypeScript Types

The canonical TypeScript type definitions are available in the `@pocket/sync-protocol` package:

```bash
npm install @pocket/sync-protocol
```

```typescript
import type {
  USPMessage,
  HandshakeMessage,
  PushMessage,
  PullMessage,
  ChangeRecord,
  VectorClock,
} from '@pocket/sync-protocol';

import {
  createHandshake,
  createPush,
  createPull,
  validateMessage,
} from '@pocket/sync-protocol';
```

## Appendix B: Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-02 | Initial specification |
