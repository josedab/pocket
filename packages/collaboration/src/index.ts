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

// Collaboration SDK (unified coordinator)
export { CollaborationSDK, createCollaborationSDK } from './collaboration-sdk.js';
export type {
  CollaborationSDKConfig,
  CollaborationSnapshot,
  RemoteEdit,
  SDKStatus,
} from './collaboration-sdk.js';

// React Collaboration Components (framework-agnostic render descriptors)
export {
  buildCursorDescriptors,
  buildPresenceDescriptors,
  buildStatusDescriptor,
  COLLAB_CSS_VARS,
} from './react-components.js';
export type {
  AvatarRenderDescriptor,
  CollabCursorsProps,
  ConnectionStatusProps,
  CursorRenderDescriptor,
  PresenceBarProps,
  SelectionHighlightProps,
  StatusRenderDescriptor,
} from './react-components.js';

// Document Sync Manager
export { DocumentSyncManager, createDocumentSyncManager } from './document-sync-manager.js';
export type {
  DocumentSyncManagerConfig,
  DocumentSyncState,
  DocumentVersion,
  SyncManagerEvent,
  SyncManagerStatus,
} from './document-sync-manager.js';

// Yjs Adapter
export { YjsAdapter, createYjsAdapter } from './yjs-adapter.js';
export type {
  YDocLike,
  YMapLike,
  YTextLike,
  YArrayLike,
  YjsAdapterConfig,
  YjsAdapterEvent,
} from './yjs-adapter.js';

// Framework Adapters (Vue/Svelte)
export {
  createVueCollabAdapters,
  createSvelteCollabAdapters,
  type VueCollabCursorsReturn,
  type VueCollabPresenceReturn,
  type VueCollabStatusReturn,
  type VueReactivity,
  type SvelteReadable,
  type SvelteStoreFactory,
} from './framework-adapters.js';

// Conflict Metrics Tracker
export {
  ConflictMetricsTracker,
  createConflictMetricsTracker,
  type ConflictEvent,
  type ConflictMetrics,
  type ConflictResolutionStrategy,
} from './conflict-metrics.js';

// Presence Throttle
export {
  PresenceThrottle,
  createPresenceThrottle,
  type PresenceThrottleConfig,
} from './presence-throttle.js';

// Undo/Redo Stack
export {
  UndoRedoStack,
  createUndoRedoStack,
  type UndoEntry,
  type UndoRedoConfig,
  type UndoRedoState,
} from './undo-redo.js';
