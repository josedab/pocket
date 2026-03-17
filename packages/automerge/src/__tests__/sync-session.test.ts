import { beforeEach, describe, expect, it } from 'vitest';
import { createCrdtDocument } from '../crdt-document.js';
import { createSyncSession, mergeSyncMessages } from '../sync-session.js';
import type { CrdtDocument, CrdtSyncMessage } from '../types.js';

describe('createSyncSession', () => {
  let localDoc: CrdtDocument<{ x: number; y: string }>;

  beforeEach(() => {
    localDoc = createCrdtDocument({ x: 0, y: '' }, 'local');
  });

  describe('peer management', () => {
    it('should start with no peers', () => {
      const session = createSyncSession('doc-1', localDoc);
      expect(session.getPeerStates()).toHaveLength(0);
    });

    it('should add peers', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      session.addPeer('peer-2');
      expect(session.getPeerStates()).toHaveLength(2);
    });

    it('should not duplicate peers on re-add', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      session.addPeer('peer-1');
      expect(session.getPeerStates()).toHaveLength(1);
    });

    it('should remove peers', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      session.addPeer('peer-2');
      session.removePeer('peer-1');
      expect(session.getPeerStates()).toHaveLength(1);
      expect(session.getPeerStates()[0]!.peerId).toBe('peer-2');
    });

    it('should silently handle removing non-existent peer', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.removePeer('does-not-exist');
      expect(session.getPeerStates()).toHaveLength(0);
    });

    it('should initialize peers with correct default state', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      const peer = session.getPeerStates()[0]!;
      expect(peer.peerId).toBe('peer-1');
      expect(peer.lastHeads).toHaveLength(0);
      expect(peer.hasPendingChanges).toBe(true);
      expect(peer.lastSyncAt).toBe(0);
      expect(peer.syncCount).toBe(0);
    });
  });

  describe('generateMessage', () => {
    it('should generate message for known peer when there are changes', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      localDoc.change((d) => {
        (d as Record<string, unknown>).x = 5;
      });

      const msg = session.generateMessage('peer-1');
      expect(msg).not.toBeNull();
      expect(msg!.targetId).toBe('peer-1');
      expect(msg!.changes.length).toBeGreaterThan(0);
    });

    it('should return null when no changes to send', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      // No changes made
      const msg = session.generateMessage('peer-1');
      expect(msg).toBeNull();
    });

    it('should throw for unknown peer', () => {
      const session = createSyncSession('doc-1', localDoc);
      expect(() => session.generateMessage('unknown')).toThrow('Unknown peer');
    });

    it('should return null after destroy', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      localDoc.change((d) => {
        (d as Record<string, unknown>).x = 5;
      });
      session.destroy();

      const msg = session.generateMessage('peer-1');
      expect(msg).toBeNull();
    });

    it('should update peer state when no changes (mark as not pending)', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      // Generate when there's nothing to send
      session.generateMessage('peer-1');
      const peer = session.getPeerStates()[0]!;
      expect(peer.hasPendingChanges).toBe(false);
    });
  });

  describe('receiveMessage', () => {
    it('should apply changes from received message', () => {
      const remoteDoc = createCrdtDocument({ x: 0, y: '' }, 'remote');
      remoteDoc.change((d) => {
        (d as Record<string, unknown>).x = 42;
      });

      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('remote');

      const msg = remoteDoc.generateSyncMessage([]);
      expect(msg).not.toBeNull();

      const result = session.receiveMessage({ ...msg!, senderId: 'remote', targetId: 'local' });
      expect(result.success).toBe(true);
      expect(localDoc.getState().value.x).toBe(42);
    });

    it('should update peer state after receiving message', () => {
      const remoteDoc = createCrdtDocument({ x: 0, y: '' }, 'remote');
      remoteDoc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });

      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('remote');

      const msg = remoteDoc.generateSyncMessage([]);
      session.receiveMessage({ ...msg!, senderId: 'remote', targetId: 'local' });

      const peer = session.getPeerStates()[0]!;
      expect(peer.syncCount).toBe(1);
      expect(peer.lastSyncAt).toBeGreaterThan(0);
      expect(peer.hasPendingChanges).toBe(false);
    });

    it('should mark other peers as having pending changes after receive', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('remote-1');
      session.addPeer('remote-2');

      // Generate for both so they're marked as not pending
      session.generateMessage('remote-1');
      session.generateMessage('remote-2');

      const remoteDoc = createCrdtDocument({ x: 0, y: '' }, 'remote-1');
      remoteDoc.change((d) => {
        (d as Record<string, unknown>).x = 1;
      });
      const msg = remoteDoc.generateSyncMessage([]);

      session.receiveMessage({ ...msg!, senderId: 'remote-1', targetId: 'local' });

      const peers = session.getPeerStates();
      const peer1 = peers.find((p) => p.peerId === 'remote-1')!;
      const peer2 = peers.find((p) => p.peerId === 'remote-2')!;

      expect(peer1.hasPendingChanges).toBe(false);
      expect(peer2.hasPendingChanges).toBe(true);
    });

    it('should return failure after destroy', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.destroy();

      const msg: CrdtSyncMessage = {
        senderId: 'remote',
        targetId: 'local',
        changes: [],
        heads: [],
        needsResponse: false,
      };
      const result = session.receiveMessage(msg);
      expect(result.success).toBe(false);
    });

    it('should handle message from unknown sender (not in peers)', () => {
      const session = createSyncSession('doc-1', localDoc);
      // Don't add the peer

      const remoteDoc = createCrdtDocument({ x: 0, y: '' }, 'unknown-sender');
      remoteDoc.change((d) => {
        (d as Record<string, unknown>).x = 99;
      });
      const msg = remoteDoc.generateSyncMessage([]);

      // Should still apply changes even if sender is not a registered peer
      const result = session.receiveMessage({
        ...msg!,
        senderId: 'unknown-sender',
        targetId: 'local',
      });
      expect(result.success).toBe(true);
      expect(localDoc.getState().value.x).toBe(99);
    });
  });

  describe('isFullySynced', () => {
    it('should return true when no peers', () => {
      const session = createSyncSession('doc-1', localDoc);
      expect(session.isFullySynced()).toBe(true);
    });

    it('should return false when peers have pending changes', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      expect(session.isFullySynced()).toBe(false);
    });

    it('should return true after all peers are synced', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      // Generate with no changes marks as not pending
      session.generateMessage('peer-1');
      expect(session.isFullySynced()).toBe(true);
    });
  });

  describe('documentId', () => {
    it('should expose the document ID', () => {
      const session = createSyncSession('my-doc-id', localDoc);
      expect(session.documentId).toBe('my-doc-id');
    });
  });

  describe('destroy', () => {
    it('should clear all peers', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.addPeer('peer-1');
      session.addPeer('peer-2');
      session.destroy();
      expect(session.getPeerStates()).toHaveLength(0);
    });

    it('should throw on addPeer after destroy', () => {
      const session = createSyncSession('doc-1', localDoc);
      session.destroy();
      expect(() => session.addPeer('peer-1')).toThrow('destroyed');
    });
  });
});

describe('mergeSyncMessages', () => {
  it('should apply multiple messages in sequence', () => {
    const target = createCrdtDocument({ a: 0, b: 0 }, 'target');
    const src1 = createCrdtDocument({ a: 0, b: 0 }, 'src1');
    const src2 = createCrdtDocument({ a: 0, b: 0 }, 'src2');

    src1.change((d) => {
      (d as Record<string, unknown>).a = 10;
    });
    src2.change((d) => {
      (d as Record<string, unknown>).b = 20;
    });

    const msg1 = src1.generateSyncMessage([]);
    const msg2 = src2.generateSyncMessage([]);

    const messages: CrdtSyncMessage[] = [];
    if (msg1) messages.push(msg1);
    if (msg2) messages.push(msg2);

    const results = mergeSyncMessages(target, messages);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(target.getState().value.a).toBe(10);
    expect(target.getState().value.b).toBe(20);
  });

  it('should return empty array for empty messages', () => {
    const doc = createCrdtDocument({ x: 1 }, 'a');
    const results = mergeSyncMessages(doc, []);
    expect(results).toHaveLength(0);
  });

  it('should handle messages with overlapping changes gracefully', () => {
    const target = createCrdtDocument({ v: 0 }, 'target');
    const src = createCrdtDocument({ v: 0 }, 'src');

    src.change((d) => {
      (d as Record<string, unknown>).v = 1;
    });
    src.change((d) => {
      (d as Record<string, unknown>).v = 2;
    });

    const msg = src.generateSyncMessage([]);
    if (msg) {
      // Apply the same message twice
      const results = mergeSyncMessages(target, [msg, msg]);
      expect(results).toHaveLength(2);
      expect(results[0]!.appliedCount).toBeGreaterThan(0);
      // Second application should skip duplicates
      expect(results[1]!.appliedCount).toBe(0);
    }
  });
});
