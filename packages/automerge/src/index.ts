/**
 * @module @pocket/automerge
 *
 * Automerge CRDT integration for Pocket database. Provides conflict-free
 * real-time synchronization using document-level CRDTs that automatically
 * merge concurrent edits without data loss.
 *
 * @example
 * ```typescript
 * import { createAutomergeSyncAdapter, createCrdtDocument } from '@pocket/automerge';
 *
 * const adapter = createAutomergeSyncAdapter({ actorId: 'user-1' });
 * const doc = createCrdtDocument({ title: 'Hello', count: 0 });
 * ```
 */

// Types
export type {
  AutomergeConfig,
  AutomergeSyncAdapter,
  CrdtChange,
  CrdtDocument,
  CrdtDocumentState,
  CrdtSyncMessage,
  MergeResult,
  MergeStrategy,
  PeerState,
  SyncSession,
} from './types.js';

// Core
export { createAutomergeSyncAdapter } from './automerge-sync-adapter.js';
export { createCrdtDocument, applyCrdtChanges } from './crdt-document.js';
export { createSyncSession, mergeSyncMessages } from './sync-session.js';
export { createMergeResolver } from './merge-resolver.js';
