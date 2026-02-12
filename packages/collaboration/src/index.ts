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
export { WebSocketTransport, createWebSocketTransport } from './websocket-transport.js';
export type { WebSocketConnectionState, WebSocketTransportConfig } from './websocket-transport.js';

// Awareness Protocol
export { AwarenessProtocol, createAwarenessProtocol } from './awareness.js';
export type { AwarenessConfig, AwarenessState } from './awareness.js';

// Conflict Resolution
export { CollabConflictResolver, createConflictResolver } from './conflict-resolver.js';
export type {
  ConflictInfo,
  ConflictResolution,
  ConflictStrategy,
  CustomResolverFn,
} from './conflict-resolver.js';

// Commenting System
export { CommentingSystem, createCommentingSystem } from './commenting.js';
export type {
  Comment,
  CommentEvent,
  CommentEventType,
  CommentReaction,
  CommentStatus,
  CommentThread,
  CommentingConfig,
  CreateThreadInput,
  Mention,
  ReplyInput,
} from './commenting.js';

// Permissions Manager
export { PermissionsManager, createPermissionsManager } from './permissions.js';
export type {
  PermissionChangeEvent,
  PermissionEntry,
  PermissionRole,
  PermissionScope,
  PermissionsConfig,
} from './permissions.js';

// CRDT Document
export { CRDTDocument, createCRDTDocument } from './crdt-document.js';
export type {
  CRDTDocumentConfig,
  CRDTDocumentState,
  CRDTOperation,
  CRDTOperationType,
  CRDTSnapshot,
} from './crdt-document.js';

// Cursor Overlay
export { CursorOverlay, createCursorOverlay } from './cursor-overlay.js';
export type {
  CursorEvent,
  CursorEventType,
  CursorOverlayConfig,
  CursorPosition,
  RemoteCursor,
  RemoteCursorInput,
  SelectionRange,
} from './cursor-overlay.js';

// Collaborative Canvas
export { CanvasEngine, createCanvasEngine, DEFAULT_CANVAS_STYLE } from './canvas-engine.js';
export type {
  CanvasCursor,
  CanvasEngineConfig,
  CanvasEvent,
  CanvasOperation,
  CanvasOperationType,
  CanvasShape,
  CanvasSnapshot,
  CanvasTool,
  CanvasViewport,
  Point,
  ShapeStyle,
  ShapeType,
} from './canvas-engine.js';
