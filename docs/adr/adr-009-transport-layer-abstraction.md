# ADR-009: Transport Layer Abstraction for Sync

## Status

Accepted

## Context

Pocket's sync engine needs to communicate with remote servers to synchronize data across devices. Different deployment scenarios have different requirements:

- **Real-time applications**: Need instant updates (collaborative editing, chat)
- **Background sync**: Can tolerate higher latency (periodic backups)
- **Network constraints**: Some environments block WebSockets (corporate firewalls)
- **Offline-first**: Must handle network unavailability gracefully
- **Cost optimization**: Long-polling may be cheaper than persistent connections

The challenge is supporting multiple transport mechanisms without coupling the sync logic to a specific protocol.

## Decision

Implement a transport abstraction layer that separates sync protocol logic from network communication.

### Transport Interface

```typescript
interface SyncTransport {
  readonly state$: Observable<TransportState>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  send(message: SyncMessage): Promise<void>;
  messages$: Observable<SyncMessage>;

  isAvailable(): boolean;
}

type TransportState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface SyncMessage {
  type: 'push' | 'push-response' | 'pull' | 'pull-response' | 'ack' | 'error';
  payload: unknown;
  timestamp: number;
  messageId: string;
}
```

### Built-in Transports

| Transport | Use Case | Connection Type |
|-----------|----------|-----------------|
| `WebSocketTransport` | Real-time sync (default) | Persistent |
| `HttpTransport` | Firewall-restricted environments | Polling |
| `HybridTransport` | Automatic fallback | WebSocket → HTTP |

### WebSocket Transport (Primary)

```typescript
const wsTransport = createWebSocketTransport({
  serverUrl: 'wss://sync.example.com',
  authToken: token,
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    backoff: 'exponential',
    initialDelay: 1000,
    maxDelay: 30000
  },
  heartbeat: {
    interval: 30000,
    timeout: 5000
  }
});
```

Features:
- Automatic reconnection with exponential backoff
- Heartbeat/ping-pong for connection health
- Binary message support for efficiency
- Connection state observable

### HTTP Transport (Fallback)

```typescript
const httpTransport = createHttpTransport({
  serverUrl: 'https://api.example.com/sync',
  authToken: token,
  pollInterval: 5000,
  longPolling: true,
  batchRequests: true
});
```

Features:
- Long-polling for near-real-time updates
- Request batching to reduce overhead
- Works through all proxies and firewalls
- Stateless (each request independent)

### Hybrid Transport (Recommended for Production)

```typescript
const transport = createHybridTransport({
  primary: createWebSocketTransport({ serverUrl: 'wss://...' }),
  fallback: createHttpTransport({ serverUrl: 'https://...' }),
  fallbackAfter: 5000,  // Fall back after 5s of failures
  retryPrimary: 60000   // Retry primary every 60s
});
```

### Sync Engine Integration

```typescript
const sync = createSyncEngine(db, {
  transport: createHybridTransport({...}),
  // OR use shorthand:
  serverUrl: 'wss://sync.example.com',  // Auto-creates WebSocket transport
  collections: ['todos', 'notes']
});
```

### Message Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      Sync Engine                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │            Protocol Logic (transport-agnostic)       │    │
│  │  - Change detection                                  │    │
│  │  - Conflict resolution                               │    │
│  │  - Checkpoint management                             │    │
│  └─────────────────────────┬───────────────────────────┘    │
└────────────────────────────┼────────────────────────────────┘
                             │ SyncMessage
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Transport Layer                           │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │   WebSocket   │  │     HTTP      │  │    Hybrid     │   │
│  │   Transport   │  │   Transport   │  │   Transport   │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
                      Network (Internet)
```

## Consequences

### Positive

- **Flexibility**: Choose transport based on deployment requirements
- **Resilience**: Hybrid transport handles network failures gracefully
- **Testability**: Mock transports for unit testing sync logic
- **Future-proof**: Easy to add new transports (WebRTC, Server-Sent Events)
- **Environment compatibility**: Works in browsers, Node.js, React Native

### Negative

- **Abstraction overhead**: Extra layer between sync logic and network
- **Configuration complexity**: More options to understand and configure
- **Debugging**: Transport issues require understanding multiple layers
- **Size**: Each transport adds to bundle size

### Mitigations

1. **Defaults**: WebSocket transport is default; most users don't configure
2. **Tree-shaking**: Only import transports you use
3. **Debug logging**: Comprehensive logging for transport state changes
4. **Documentation**: Clear guidance on when to use each transport

## Alternatives Considered

### 1. WebSocket Only

Hard-code WebSocket as the only transport.

Rejected because:
- Some corporate environments block WebSockets
- No fallback when WebSockets fail
- Limits deployment flexibility

### 2. HTTP Only

Use HTTP polling for all sync operations.

Rejected because:
- Higher latency (polling interval)
- More server load (frequent requests)
- Not suitable for real-time features

### 3. Socket.io

Use Socket.io which has built-in transport fallback.

Rejected because:
- Large bundle size (~40KB)
- Requires Socket.io server
- Less control over protocol
- Not needed—our abstraction is simpler

### 4. GraphQL Subscriptions

Use GraphQL with subscription support.

Rejected because:
- Requires GraphQL server infrastructure
- More complex than needed for sync
- Doesn't match push/pull sync model

## Custom Transport Example

```typescript
import { SyncTransport, SyncMessage } from '@pocket/sync';

class CustomTransport implements SyncTransport {
  readonly state$ = new BehaviorSubject<TransportState>('disconnected');
  readonly messages$ = new Subject<SyncMessage>();

  async connect(): Promise<void> {
    this.state$.next('connecting');
    // Custom connection logic
    this.state$.next('connected');
  }

  async disconnect(): Promise<void> {
    // Custom disconnection logic
    this.state$.next('disconnected');
  }

  async send(message: SyncMessage): Promise<void> {
    // Custom send logic
  }

  isAvailable(): boolean {
    return true;
  }
}
```

## References

- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [HTTP Long Polling](https://www.pubnub.com/blog/http-long-polling/)
- [Socket.io Transport Fallback](https://socket.io/docs/v4/how-it-works/)
