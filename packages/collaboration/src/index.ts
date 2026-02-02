/**
 * @pocket/collaboration — Turnkey real-time collaboration engine
 *
 * Combines session management, cursor/selection tracking, document change
 * broadcasting, and user presence into a unified API.
 *
 * @example
 * ```typescript
 * import { createCollabSession, createMemoryTransportHub } from '@pocket/collaboration';
 *
 * const hub = createMemoryTransportHub();
 * const session = createCollabSession({
 *   sessionId: 'doc-123',
 *   user: { id: 'user-1', name: 'Alice' },
 *   transport: hub.createTransport(),
 * });
 *
 * await session.connect();
 *
 * session.users$.subscribe(users => console.log('Active users:', users));
 * session.cursors$.subscribe(cursors => console.log('Cursors:', cursors));
 *
 * session.updateCursor({ documentId: 'doc-123', offset: 42 });
 * session.broadcastChange({
 *   documentId: 'doc-123',
 *   collection: 'notes',
 *   operations: [{ type: 'set', path: 'title', value: 'Hello' }],
 * });
 * ```
 *
 * @module @pocket/collaboration
 */

// Types
export type {
  CollabCursor,
  CollabEvent,
  CollabMessage,
  CollabSelection,
  CollabSessionConfig,
  CollabSessionStatus,
  CollabTransport,
  CollabUser,
  DocumentChange,
  DocumentOperation,
} from './types.js';

// Session
export { CollabSession, createCollabSession } from './collab-session.js';

// Memory Transport (testing)
export {
  MemoryTransport,
  MemoryTransportHub,
  createMemoryTransportHub,
} from './memory-transport.js';

// WebSocket Transport (production)
export type { WebSocketConnectionState, WebSocketTransportConfig } from './websocket-transport.js';
export { WebSocketTransport, createWebSocketTransport } from './websocket-transport.js';

// Awareness Protocol
export type { AwarenessConfig, AwarenessState } from './awareness.js';
export { AwarenessProtocol, createAwarenessProtocol } from './awareness.js';

// Conflict Resolution
export type {
  ConflictInfo,
  ConflictResolution,
  ConflictStrategy,
  CustomResolverFn,
} from './conflict-resolver.js';
export { CollabConflictResolver, createConflictResolver } from './conflict-resolver.js';
