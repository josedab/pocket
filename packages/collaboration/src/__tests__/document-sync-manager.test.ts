import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DocumentSyncManager,
  createDocumentSyncManager,
  type DocumentVersion,
  type SyncManagerEvent,
} from '../document-sync-manager.js';
import type { CollabTransport, CollabMessage } from '../types.js';

function createMockTransport(): CollabTransport & { triggerMessage: (msg: CollabMessage) => void } {
  let handler: ((msg: CollabMessage) => void) | null = null;
  return {
    send: () => {},
    onMessage: (h) => {
      handler = h;
      return () => { handler = null; };
    },
    triggerMessage: (msg) => handler?.(msg),
  };
}

describe('DocumentSyncManager', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let manager: DocumentSyncManager;

  beforeEach(() => {
    transport = createMockTransport();
    manager = createDocumentSyncManager({
      transport,
      user: { id: 'user-1', name: 'Alice' },
      debounceMs: 0,
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('document tracking', () => {
    it('should track a document', () => {
      manager.trackDocument('doc-1');
      expect(manager.getTrackedDocuments()).toContain('doc-1');
      expect(manager.getDocumentState('doc-1')).toBe('synced');
    });

    it('should untrack a document', () => {
      manager.trackDocument('doc-1');
      manager.untrackDocument('doc-1');
      expect(manager.getTrackedDocuments()).not.toContain('doc-1');
    });

    it('should return null state for untracked doc', () => {
      expect(manager.getDocumentState('unknown')).toBeNull();
    });
  });

  describe('local changes', () => {
    it('should accept local operations', (ctx) => {
      return new Promise<void>((resolve) => {
        manager.trackDocument('doc-1');
        manager.events.subscribe((event) => {
          if (event.type === 'sync-complete') {
            const history = manager.getHistory('doc-1');
            expect(history.length).toBe(1);
            expect(history[0]!.userId).toBe('user-1');
            expect(history[0]!.operations).toHaveLength(1);
            resolve();
          }
        });
        manager.applyLocal('doc-1', [{ type: 'set', path: 'title', value: 'Hello' }]);
      });
    });

    it('should create version entries in history', (ctx) => {
      return new Promise<void>((resolve) => {
        manager.trackDocument('doc-1');
        manager.events.subscribe((event) => {
          if (event.type === 'version-created') {
            const history = manager.getHistory('doc-1');
            expect(history.length).toBeGreaterThan(0);
            resolve();
          }
        });
        manager.applyLocal('doc-1', [{ type: 'set', path: 'title', value: 'Test' }]);
      });
    });
  });

  describe('remote changes', () => {
    it('should process incoming remote changes', () => {
      manager.trackDocument('doc-1');
      const events: SyncManagerEvent[] = [];
      manager.events.subscribe((e) => events.push(e));

      transport.triggerMessage({
        type: 'operation',
        sessionId: 'doc-1',
        userId: 'user-2',
        timestamp: Date.now(),
        payload: {
          documentId: 'doc-1',
          collection: 'notes',
          operations: [{ type: 'set', path: 'title', value: 'Remote Title' }],
          userId: 'user-2',
          timestamp: Date.now(),
        },
      });

      expect(events.some((e) => e.type === 'remote-change')).toBe(true);
      const history = manager.getHistory('doc-1');
      expect(history.length).toBe(1);
    });
  });

  describe('version history', () => {
    it('should support reverting to a version', () => {
      manager.trackDocument('doc-1');

      // Simulate a remote change to have history
      transport.triggerMessage({
        type: 'operation',
        sessionId: 'doc-1',
        userId: 'user-2',
        timestamp: Date.now(),
        payload: {
          documentId: 'doc-1',
          collection: 'notes',
          operations: [{ type: 'set', path: 'body', value: 'original' }],
          userId: 'user-2',
          timestamp: Date.now(),
        },
      });

      const history = manager.getHistory('doc-1');
      const versionId = history[0]!.versionId;
      const reverted = manager.revertToVersion('doc-1', versionId);
      expect(reverted).not.toBeNull();
      expect(reverted!.label).toContain('Reverted');
    });

    it('should return null for unknown version', () => {
      manager.trackDocument('doc-1');
      expect(manager.revertToVersion('doc-1', 'nonexistent')).toBeNull();
    });

    it('should return null for untracked doc', () => {
      expect(manager.revertToVersion('unknown', 'v1')).toBeNull();
    });
  });

  describe('status', () => {
    it('should report synced status initially', () => {
      manager.trackDocument('doc-1');
      const status = manager.getStatus();
      expect(status.state).toBe('synced');
      expect(status.pendingChanges).toBe(0);
    });
  });
});
