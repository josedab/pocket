/**
 * @module sync-session
 *
 * Manages bidirectional sync sessions between peers using CRDT documents.
 */

import type {
  CrdtDocument,
  CrdtSyncMessage,
  MergeResult,
  PeerState,
  SyncSession,
} from './types.js';

/**
 * Creates a sync session for coordinating CRDT sync across multiple peers.
 *
 * @param documentId - The document being synced
 * @param localDocument - The local CRDT document instance
 * @returns A SyncSession for managing peer connections
 *
 * @example
 * ```typescript
 * const session = createSyncSession('doc-1', localDoc);
 * session.addPeer('peer-2');
 * const msg = session.generateMessage('peer-2');
 * ```
 */
export function createSyncSession(
  documentId: string,
  localDocument: CrdtDocument,
): SyncSession {
  const peers = new Map<string, PeerState>();
  let destroyed = false;

  function addPeer(peerId: string): void {
    if (destroyed) throw new Error('Session has been destroyed');
    if (peers.has(peerId)) return;

    peers.set(peerId, {
      peerId,
      lastHeads: [],
      hasPendingChanges: true,
      lastSyncAt: 0,
      syncCount: 0,
    });
  }

  function removePeer(peerId: string): void {
    peers.delete(peerId);
  }

  function getPeerStates(): ReadonlyArray<PeerState> {
    return [...peers.values()];
  }

  function generateMessage(peerId: string): CrdtSyncMessage | null {
    if (destroyed) return null;

    const peer = peers.get(peerId);
    if (!peer) throw new Error(`Unknown peer: ${peerId}`);

    const msg = localDocument.generateSyncMessage(peer.lastHeads);
    if (!msg) {
      peers.set(peerId, { ...peer, hasPendingChanges: false });
      return null;
    }

    return { ...msg, targetId: peerId };
  }

  function receiveMessage(message: CrdtSyncMessage): MergeResult {
    if (destroyed) {
      return {
        success: false,
        state: localDocument.getState(),
        appliedCount: 0,
        conflicts: [],
      };
    }

    const result = localDocument.receiveSyncMessage(message);

    const peer = peers.get(message.senderId);
    if (peer) {
      peers.set(message.senderId, {
        ...peer,
        lastHeads: [...message.heads],
        lastSyncAt: Date.now(),
        syncCount: peer.syncCount + 1,
        hasPendingChanges: false,
      });
    }

    // After receiving, we may have new changes to send to other peers
    for (const [id, p] of peers) {
      if (id !== message.senderId) {
        peers.set(id, { ...p, hasPendingChanges: true });
      }
    }

    return result;
  }

  function isFullySynced(): boolean {
    return [...peers.values()].every((p) => !p.hasPendingChanges);
  }

  function destroy(): void {
    destroyed = true;
    peers.clear();
  }

  return {
    documentId,
    addPeer,
    removePeer,
    getPeerStates,
    generateMessage,
    receiveMessage,
    isFullySynced,
    destroy,
  };
}

/**
 * Merges sync messages from multiple peers into a target document.
 *
 * @param document - The target CRDT document
 * @param messages - Sync messages to apply in order
 * @returns Array of merge results, one per message
 */
export function mergeSyncMessages(
  document: CrdtDocument,
  messages: ReadonlyArray<CrdtSyncMessage>,
): ReadonlyArray<MergeResult> {
  return messages.map((msg) => document.receiveSyncMessage(msg));
}
