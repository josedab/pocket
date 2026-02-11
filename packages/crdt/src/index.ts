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
