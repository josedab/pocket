import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AwarenessProtocol,
  createAwarenessProtocol,
  type AwarenessConfig,
  type AwarenessState,
} from '../awareness.js';
import {
  CollabConflictResolver,
  createConflictResolver,
  type ConflictInfo,
  type ConflictResolution,
} from '../conflict-resolver.js';
import type { DocumentChange } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────

function makeAwarenessConfig(overrides?: Partial<AwarenessConfig>): AwarenessConfig {
  return {
    localUserId: 'user-1',
    localUserName: 'Alice',
    inactivityTimeoutMs: 30_000,
    broadcastIntervalMs: 100,
    ...overrides,
  };
}

function makeChange(
  overrides: Partial<DocumentChange> & { documentId: string; timestamp: number },
): DocumentChange {
  return {
    collection: 'docs',
    operations: [],
    userId: 'user-1',
    ...overrides,
  };
}

function makeConflict(overrides?: Partial<ConflictInfo>): ConflictInfo {
  return {
    documentId: 'doc-1',
    localChange: makeChange({
      documentId: 'doc-1',
      timestamp: 100,
      userId: 'user-1',
      operations: [{ type: 'set', path: 'title', value: 'Local Title' }],
    }),
    remoteChange: makeChange({
      documentId: 'doc-1',
      timestamp: 200,
      userId: 'user-2',
      operations: [{ type: 'set', path: 'title', value: 'Remote Title' }],
    }),
    timestamp: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// AwarenessProtocol
// ═══════════════════════════════════════════════════════════════

describe('AwarenessProtocol', () => {
  let protocol: AwarenessProtocol;

  afterEach(() => {
    protocol?.destroy();
  });

  // ── Initialization ────────────────────────────────────────

  it('should initialize with local user state', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    const local = protocol.getLocalState();
    expect(local).toBeDefined();
    expect(local.userId).toBe('user-1');
    expect(local.name).toBe('Alice');
    expect(local.lastActive).toBeGreaterThan(0);
  });

  it('should auto-assign color if not provided', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    const local = protocol.getLocalState();
    expect(local.color).toBeDefined();
    expect(local.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('should use provided color when specified', () => {
    protocol = createAwarenessProtocol(
      makeAwarenessConfig({ localUserColor: '#ABCDEF' }),
    );

    expect(protocol.getLocalState().color).toBe('#ABCDEF');
  });

  // ── Local state updates ───────────────────────────────────

  it('should update local cursor state', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());
    protocol.setCursor(10, 5);

    const local = protocol.getLocalState();
    expect(local.cursor).toEqual({ line: 10, column: 5 });
  });

  it('should update local selection state', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());
    protocol.setSelection({ line: 1, column: 0 }, { line: 3, column: 10 });

    const local = protocol.getLocalState();
    expect(local.selection).toEqual({
      start: { line: 1, column: 0 },
      end: { line: 3, column: 10 },
    });
  });

  it('should update local typing indicator', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    protocol.setTyping(true);
    expect(protocol.getLocalState().isTyping).toBe(true);

    protocol.setTyping(false);
    expect(protocol.getLocalState().isTyping).toBe(false);
  });

  // ── Active users ──────────────────────────────────────────

  it('should return active users', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    // Add a remote user
    protocol.applyRemoteState({
      userId: 'user-2',
      name: 'Bob',
      color: '#FF0000',
      lastActive: Date.now(),
    });

    const active = protocol.getActiveUsers();
    expect(active).toHaveLength(2);
    expect(active.map((u) => u.userId).sort()).toEqual(['user-1', 'user-2']);
  });

  it('should include all states via getStates', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    protocol.applyRemoteState({
      userId: 'user-2',
      name: 'Bob',
      color: '#FF0000',
      lastActive: Date.now(),
    });

    const states = protocol.getStates();
    expect(states.size).toBe(2);
    expect(states.get('user-1')?.name).toBe('Alice');
    expect(states.get('user-2')?.name).toBe('Bob');
  });

  // ── Inactivity timeout ────────────────────────────────────

  it('should remove inactive users after timeout', () => {
    vi.useFakeTimers();

    try {
      protocol = createAwarenessProtocol(
        makeAwarenessConfig({ inactivityTimeoutMs: 1000 }),
      );

      // Add a remote peer
      protocol.applyRemoteState({
        userId: 'user-2',
        name: 'Bob',
        color: '#FF0000',
        lastActive: Date.now(),
      });

      expect(protocol.getStates().size).toBe(2);

      // Advance past the inactivity timeout + check interval
      vi.advanceTimersByTime(1500);

      // Remote user should have been evicted
      expect(protocol.getStates().has('user-2')).toBe(false);
      expect(protocol.getStates().size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should never evict the local user due to inactivity', () => {
    vi.useFakeTimers();

    try {
      protocol = createAwarenessProtocol(
        makeAwarenessConfig({ inactivityTimeoutMs: 1000 }),
      );

      vi.advanceTimersByTime(5000);

      expect(protocol.getStates().has('user-1')).toBe(true);
      expect(protocol.getLocalState().userId).toBe('user-1');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Observable / callbacks ────────────────────────────────

  it('should expose states via observable', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    const emitted: Map<string, AwarenessState>[] = [];
    const sub = protocol.states$.subscribe((states) => emitted.push(states));

    // Initial emission from BehaviorSubject
    expect(emitted).toHaveLength(1);

    protocol.setCursor(1, 1);
    expect(emitted).toHaveLength(2);

    sub.unsubscribe();
  });

  it('should notify callbacks on state changes', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    const callback = vi.fn();
    const unsubscribe = protocol.onStateChange(callback);

    protocol.setCursor(5, 3);
    expect(callback).toHaveBeenCalledTimes(1);

    const states = callback.mock.calls[0][0] as Map<string, AwarenessState>;
    expect(states.get('user-1')?.cursor).toEqual({ line: 5, column: 3 });

    unsubscribe();
    protocol.setCursor(10, 1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  // ── Remote state ──────────────────────────────────────────

  it('should ignore remote state from the local user id', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    protocol.applyRemoteState({
      userId: 'user-1',
      name: 'Imposter',
      color: '#000000',
      lastActive: Date.now(),
    });

    expect(protocol.getLocalState().name).toBe('Alice');
  });

  it('should remove a remote user explicitly', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());

    protocol.applyRemoteState({
      userId: 'user-2',
      name: 'Bob',
      color: '#FF0000',
      lastActive: Date.now(),
    });

    expect(protocol.getStates().size).toBe(2);

    protocol.removeRemoteUser('user-2');
    expect(protocol.getStates().size).toBe(1);
    expect(protocol.getStates().has('user-2')).toBe(false);
  });

  // ── Destroy ───────────────────────────────────────────────

  it('should not update state after destroy', () => {
    protocol = createAwarenessProtocol(makeAwarenessConfig());
    protocol.destroy();

    protocol.setCursor(1, 1);
    expect(protocol.getLocalState().cursor).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// CollabConflictResolver
// ═══════════════════════════════════════════════════════════════

describe('CollabConflictResolver', () => {
  // ── last-write-wins ───────────────────────────────────────

  describe('last-write-wins strategy', () => {
    it('should resolve with the later timestamp', () => {
      const resolver = createConflictResolver('last-write-wins');
      const conflict = makeConflict({
        localChange: makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'Local' }],
        }),
        remoteChange: makeChange({
          documentId: 'doc-1',
          timestamp: 200,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'title', value: 'Remote' }],
        }),
      });

      const result = resolver.resolve(conflict);
      expect(result.strategy).toBe('last-write-wins');
      expect(result.resolvedDocument).toEqual({ title: 'Remote' });
      expect(result.conflictsResolved).toBe(1);
    });

    it('should pick local when local timestamp is later', () => {
      const resolver = createConflictResolver('last-write-wins');
      const conflict = makeConflict({
        localChange: makeChange({
          documentId: 'doc-1',
          timestamp: 300,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'Local' }],
        }),
        remoteChange: makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'title', value: 'Remote' }],
        }),
      });

      const result = resolver.resolve(conflict);
      expect(result.resolvedDocument).toEqual({ title: 'Local' });
    });
  });

  // ── first-write-wins ──────────────────────────────────────

  describe('first-write-wins strategy', () => {
    it('should resolve with the earlier timestamp', () => {
      const resolver = createConflictResolver('first-write-wins');
      const conflict = makeConflict({
        localChange: makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'Local' }],
        }),
        remoteChange: makeChange({
          documentId: 'doc-1',
          timestamp: 200,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'title', value: 'Remote' }],
        }),
      });

      const result = resolver.resolve(conflict);
      expect(result.strategy).toBe('first-write-wins');
      expect(result.resolvedDocument).toEqual({ title: 'Local' });
      expect(result.conflictsResolved).toBe(1);
    });

    it('should pick remote when remote timestamp is earlier', () => {
      const resolver = createConflictResolver('first-write-wins');
      const conflict = makeConflict({
        localChange: makeChange({
          documentId: 'doc-1',
          timestamp: 500,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'Local' }],
        }),
        remoteChange: makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'title', value: 'Remote' }],
        }),
      });

      const result = resolver.resolve(conflict);
      expect(result.resolvedDocument).toEqual({ title: 'Remote' });
    });
  });

  // ── merge strategy ────────────────────────────────────────

  describe('merge strategy', () => {
    it('should merge non-conflicting fields from both sides', () => {
      const resolver = createConflictResolver('merge');
      const conflict = makeConflict({
        localChange: makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'Title' }],
        }),
        remoteChange: makeChange({
          documentId: 'doc-1',
          timestamp: 200,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'body', value: 'Body text' }],
        }),
      });

      const result = resolver.resolve(conflict);
      expect(result.strategy).toBe('merge');
      expect(result.resolvedDocument).toEqual({
        title: 'Title',
        body: 'Body text',
      });
    });

    it('should fall back to remote on true conflicts (LWW)', () => {
      const resolver = createConflictResolver('merge');
      const conflict = makeConflict({
        localChange: makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'Local Title' }],
        }),
        remoteChange: makeChange({
          documentId: 'doc-1',
          timestamp: 200,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'title', value: 'Remote Title' }],
        }),
      });

      const result = resolver.resolve(conflict);
      // Both modified same field, remote wins as LWW fallback
      expect(result.resolvedDocument.title).toBe('Remote Title');
    });
  });

  // ── mergeDocuments (three-way) ────────────────────────────

  describe('mergeDocuments', () => {
    it('should accept fields only present in local', () => {
      const resolver = createConflictResolver('merge');
      const merged = resolver.mergeDocuments(
        { title: 'Hello', author: 'Alice' },
        { title: 'Hello' },
      );
      expect(merged.author).toBe('Alice');
    });

    it('should accept fields only present in remote', () => {
      const resolver = createConflictResolver('merge');
      const merged = resolver.mergeDocuments(
        { title: 'Hello' },
        { title: 'Hello', tags: ['a'] },
      );
      expect(merged.tags).toEqual(['a']);
    });

    it('should prefer remote-changed field when local unchanged from base', () => {
      const resolver = createConflictResolver('merge');
      const base = { title: 'Original' };
      const local = { title: 'Original' };
      const remote = { title: 'Updated' };

      const merged = resolver.mergeDocuments(local, remote, base);
      expect(merged.title).toBe('Updated');
    });

    it('should prefer local-changed field when remote unchanged from base', () => {
      const resolver = createConflictResolver('merge');
      const base = { title: 'Original' };
      const local = { title: 'Updated' };
      const remote = { title: 'Original' };

      const merged = resolver.mergeDocuments(local, remote, base);
      expect(merged.title).toBe('Updated');
    });
  });

  // ── detectConflicts ───────────────────────────────────────

  describe('detectConflicts', () => {
    it('should detect conflicts between overlapping changes', () => {
      const resolver = createConflictResolver('merge');

      const localChanges: DocumentChange[] = [
        makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'A' }],
        }),
      ];

      const remoteChanges: DocumentChange[] = [
        makeChange({
          documentId: 'doc-1',
          timestamp: 200,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'title', value: 'B' }],
        }),
      ];

      const conflicts = resolver.detectConflicts(localChanges, remoteChanges);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].documentId).toBe('doc-1');
    });

    it('should not detect conflicts for non-overlapping paths', () => {
      const resolver = createConflictResolver('merge');

      const localChanges: DocumentChange[] = [
        makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'A' }],
        }),
      ];

      const remoteChanges: DocumentChange[] = [
        makeChange({
          documentId: 'doc-1',
          timestamp: 200,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'body', value: 'B' }],
        }),
      ];

      const conflicts = resolver.detectConflicts(localChanges, remoteChanges);
      expect(conflicts).toHaveLength(0);
    });

    it('should skip changes on different documents', () => {
      const resolver = createConflictResolver('merge');

      const localChanges: DocumentChange[] = [
        makeChange({
          documentId: 'doc-1',
          timestamp: 100,
          userId: 'user-1',
          operations: [{ type: 'set', path: 'title', value: 'A' }],
        }),
      ];

      const remoteChanges: DocumentChange[] = [
        makeChange({
          documentId: 'doc-2',
          timestamp: 200,
          userId: 'user-2',
          operations: [{ type: 'set', path: 'title', value: 'B' }],
        }),
      ];

      const conflicts = resolver.detectConflicts(localChanges, remoteChanges);
      expect(conflicts).toHaveLength(0);
    });
  });

  // ── custom resolver ───────────────────────────────────────

  describe('custom strategy', () => {
    it('should use custom resolver when provided', () => {
      const customResolver = vi.fn(
        (conflict: ConflictInfo): ConflictResolution => ({
          resolvedDocument: { title: 'Custom Resolution' },
          strategy: 'custom',
          conflictsResolved: 1,
        }),
      );

      const resolver = createConflictResolver('custom', customResolver);
      const conflict = makeConflict();

      const result = resolver.resolve(conflict);

      expect(customResolver).toHaveBeenCalledWith(conflict);
      expect(result.strategy).toBe('custom');
      expect(result.resolvedDocument).toEqual({ title: 'Custom Resolution' });
    });

    it('should throw when custom strategy is used without a resolver', () => {
      expect(() => createConflictResolver('custom')).toThrow(
        /customResolver function is required/,
      );
    });
  });
});
