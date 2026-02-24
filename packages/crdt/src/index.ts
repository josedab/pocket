// Types
export type * from './types.js';

// Clock utilities
export * from './clock.js';

// CRDT primitives
export * from './counter.js';
export * from './map.js';
export * from './register.js';
export * from './set.js';

// Document CRDT
export * from './document-crdt.js';

// Collaboration awareness
export * from './awareness.js';

// Collaborative session management
export * from './collaborative-session.js';

// Collaboration Manager
export {
  CollaborationManager,
  createCollaborationManager,
  type CollaborationConfig,
  type CollaborationManagerEvent,
  type CollaborationStatus,
  type CollaboratorInfo,
  type CursorPosition,
  type SelectionRange,
  type UndoEntry,
} from './collaboration-manager.js';

// CRDT-Sync Bridge
export { createCRDTSyncBridge } from './crdt-sync-bridge.js';
export type {
  CRDTMergeStrategy,
  CRDTSyncBridge,
  CRDTSyncBridgeConfig,
  CRDTSyncBridgeStats,
  CRDTSyncOperation,
  GCResult,
  SyncOperationBatch,
} from './crdt-sync-bridge.js';

// Rich Text CRDT
export {
  RichTextCRDT,
  createRichTextCRDT,
  type FormatType,
  type RichTextConfig,
  type RichTextSpan,
  type RichTextState,
  type TextFormat,
  type TextOperation,
  type TextPosition,
  type TextRange,
} from './rich-text-crdt.js';

// Collaborative Hooks
export {
  createCollaborativeEditSession,
  createPresenceTracker,
  type CollaborativeDocState,
  type CollaborativeEditSession,
  type CollaborativeHooksConfig,
  type PresenceState,
  type PresenceTracker,
} from './collaborative-hooks.js';

// CRDT Sync Engine
export { CRDTSyncEngine, createCRDTSyncEngine } from './crdt-sync-engine.js';
export type {
  CRDTEvent,
  CRDTFieldConfig,
  CRDTOperation,
  CRDTState,
  CRDTSyncConfig,
  CRDTType,
  MergeResult,
} from './crdt-sync-engine.js';

// Peritext Rich Text CRDT (next-gen)
export {
  PeritextDocument,
  createPeritextDocument,
  type CharAtom,
  type CharId,
  type EditorAdapter,
  type FormatMark,
  type FormattedSpan,
  type MarkType,
  type PeritextOp,
  type PeritextSnapshot,
} from './peritext.js';
