import { describe, expect, it } from 'vitest';
import {
  createAutomergeSyncAdapter,
  createCrdtDocument,
  createMergeResolver,
  createSyncSession,
  mergeSyncMessages,
} from '../index.js';
import type { CrdtSyncMessage, MergeConflict } from '../types.js';

describe('integration: multi-peer sync', () => {
  it('should synchronize three peers to convergence', () => {
    const docA = createCrdtDocument({ x: 0, y: 0, z: 0 }, 'a');
    const docB = createCrdtDocument({ x: 0, y: 0, z: 0 }, 'b');
    const docC = createCrdtDocument({ x: 0, y: 0, z: 0 }, 'c');

    // Each peer changes a different field
    docA.change((d) => {
      (d as Record<string, unknown>).x = 1;
    });
    docB.change((d) => {
      (d as Record<string, unknown>).y = 2;
    });
    docC.change((d) => {
      (d as Record<string, unknown>).z = 3;
    });

    // Sync all to A: B→A, C→A
    const msgBtoA = docB.generateSyncMessage([]);
    const msgCtoA = docC.generateSyncMessage([]);
    if (msgBtoA) docA.receiveSyncMessage(msgBtoA);
    if (msgCtoA) docA.receiveSyncMessage(msgCtoA);

    // Sync A to B and C (A has all changes now)
    const msgAtoB = docA.generateSyncMessage(docB.getState().heads);
    const msgAtoC = docA.generateSyncMessage(docC.getState().heads);
    if (msgAtoB) docB.receiveSyncMessage(msgAtoB);
    if (msgAtoC) docC.receiveSyncMessage(msgAtoC);

    // All peers should converge
    expect(docA.getState().value.x).toBe(1);
    expect(docA.getState().value.y).toBe(2);
    expect(docA.getState().value.z).toBe(3);

    expect(docB.getState().value.x).toBe(1);
    expect(docB.getState().value.y).toBe(2);
    expect(docB.getState().value.z).toBe(3);

    expect(docC.getState().value.x).toBe(1);
    expect(docC.getState().value.y).toBe(2);
    expect(docC.getState().value.z).toBe(3);
  });

  it('should handle concurrent edits to same field across peers', () => {
    const docA = createCrdtDocument({ title: 'Original' }, 'actor-a');
    const docB = createCrdtDocument({ title: 'Original' }, 'actor-b');

    docA.change((d) => {
      (d as Record<string, unknown>).title = 'Version A';
    });
    docB.change((d) => {
      (d as Record<string, unknown>).title = 'Version B';
    });

    // B applies A's changes
    const resultOnB = docB.applyChanges(docA.getState().changes);
    expect(resultOnB.conflicts.length).toBeGreaterThan(0);

    // A applies B's changes
    const resultOnA = docA.applyChanges(docB.getState().changes);
    expect(resultOnA.conflicts.length).toBeGreaterThan(0);

    // Both should converge to the same value (deterministic winner)
    expect(docA.getState().value.title).toBe(docB.getState().value.title);
  });
});

describe('integration: adapter with sync sessions', () => {
  it('should sync documents between two adapters using sync sessions', () => {
    const adapter1 = createAutomergeSyncAdapter({ actorId: 'peer-1' });
    const adapter2 = createAutomergeSyncAdapter({ actorId: 'peer-2' });

    // Create and modify a document in adapter1
    adapter1.applyLocalChange('todos', 'todo-1', (draft) => {
      (draft as Record<string, unknown>).title = 'Buy groceries';
      (draft as Record<string, unknown>).done = false;
    });

    // Create sync session from adapter1
    const session1 = adapter1.createSyncSession('todo-1');
    session1.addPeer('peer-2');

    // Generate message for peer-2
    const msg = session1.generateMessage('peer-2');
    expect(msg).not.toBeNull();

    // Ensure the document exists in adapter2 and apply the changes
    adapter2.getDocument('todos', 'todo-1');
    adapter2.applyRemoteChanges('todos', 'todo-1', msg!.changes);

    const doc2 = adapter2.getDocument('todos', 'todo-1');
    expect(doc2.getState().value).toHaveProperty('title', 'Buy groceries');
    expect(doc2.getState().value).toHaveProperty('done', false);

    adapter1.destroy();
    adapter2.destroy();
  });

  it('should support bidirectional sync via adapters', () => {
    const a1 = createAutomergeSyncAdapter({ actorId: 'p1' });
    const a2 = createAutomergeSyncAdapter({ actorId: 'p2' });

    // Both start with the same doc
    a1.getDocument('col', 'doc1');
    a2.getDocument('col', 'doc1');

    // Each makes different changes
    a1.applyLocalChange('col', 'doc1', (d) => {
      (d as Record<string, unknown>).fromP1 = true;
    });
    a2.applyLocalChange('col', 'doc1', (d) => {
      (d as Record<string, unknown>).fromP2 = true;
    });

    // Sync p1 → p2
    const changes1 = a1.getDocument('col', 'doc1').getState().changes;
    a2.applyRemoteChanges('col', 'doc1', changes1);

    // Sync p2 → p1
    const changes2 = a2.getDocument('col', 'doc1').getState().changes;
    a1.applyRemoteChanges('col', 'doc1', changes2);

    const v1 = a1.getDocument('col', 'doc1').getState().value;
    const v2 = a2.getDocument('col', 'doc1').getState().value;

    expect(v1).toHaveProperty('fromP1', true);
    expect(v1).toHaveProperty('fromP2', true);
    expect(v2).toHaveProperty('fromP1', true);
    expect(v2).toHaveProperty('fromP2', true);

    a1.destroy();
    a2.destroy();
  });
});

describe('integration: merge resolver with document conflicts', () => {
  it('should resolve conflicts using a configured merge resolver', () => {
    const resolver = createMergeResolver({
      defaultStrategy: 'auto',
      fieldStrategies: { tags: 'auto' },
    });

    const docA = createCrdtDocument({ score: 10, tags: ['a'] }, 'actor-a');
    const docB = createCrdtDocument({ score: 10, tags: ['a'] }, 'actor-b');

    docA.change((d) => {
      (d as Record<string, unknown>).score = 15;
    });
    docB.change((d) => {
      (d as Record<string, unknown>).score = 20;
    });

    const result = docB.applyChanges(docA.getState().changes);

    // Use resolver on reported conflicts
    for (const conflict of result.conflicts) {
      const resolved = resolver.resolve(conflict);
      expect(resolved).toBeDefined();
    }
  });

  it('should use custom resolver to concatenate conflicting strings', () => {
    const resolver = createMergeResolver({
      defaultStrategy: 'custom',
      customResolver: (c) => {
        if (typeof c.localValue === 'string' && typeof c.remoteValue === 'string') {
          return `${c.localValue} | ${c.remoteValue}`;
        }
        return c.resolvedValue;
      },
    });

    const conflict: MergeConflict = {
      path: ['description'],
      localValue: 'Local desc',
      remoteValue: 'Remote desc',
      resolvedValue: 'Remote desc',
      winner: 'remote',
    };

    expect(resolver.resolve(conflict)).toBe('Local desc | Remote desc');
  });
});

describe('integration: serialization round-trip', () => {
  it('should serialize and deserialize document state as JSON', () => {
    const doc = createCrdtDocument({ title: 'Test', items: [1, 2, 3] }, 'actor-1');
    doc.change((d) => {
      (d as Record<string, unknown>).title = 'Updated';
    });

    const state = doc.getState();
    const json = JSON.stringify(state);
    const parsed = JSON.parse(json);

    expect(parsed.value.title).toBe('Updated');
    expect(parsed.value.items).toEqual([1, 2, 3]);
    expect(parsed.actorId).toBe('actor-1');
    expect(parsed.clock).toBe(1);
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.heads).toHaveLength(1);
  });

  it('should serialize changes for transport', () => {
    const doc = createCrdtDocument({ x: 0 }, 'a');
    doc.change((d) => {
      (d as Record<string, unknown>).x = 42;
    });
    doc.change((d) => {
      (d as Record<string, unknown>).x = 100;
    });

    const changes = doc.getState().changes;
    const json = JSON.stringify(changes);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].actorId).toBe('a');
    expect(parsed[0].operations.length).toBeGreaterThan(0);
  });

  it('should serialize sync messages for transport', () => {
    const doc = createCrdtDocument({ v: 1 }, 'sender');
    doc.change((d) => {
      (d as Record<string, unknown>).v = 2;
    });

    const msg = doc.generateSyncMessage([]);
    expect(msg).not.toBeNull();

    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);

    expect(parsed.senderId).toBe('sender');
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.needsResponse).toBe(true);
  });
});

describe('integration: fork and sync', () => {
  it('should fork a document and sync changes back', () => {
    const original = createCrdtDocument({ counter: 0, label: 'main' }, 'original');
    original.change((d) => {
      (d as Record<string, unknown>).counter = 5;
    });

    const forked = original.fork('forked');
    forked.change((d) => {
      (d as Record<string, unknown>).label = 'forked-edit';
    });

    // Sync forked changes back to original
    const msg = forked.generateSyncMessage(original.getState().heads);
    if (msg) {
      original.receiveSyncMessage(msg);
    }

    expect(original.getState().value.label).toBe('forked-edit');
    expect(original.getState().value.counter).toBe(5);
  });
});

describe('integration: edge cases', () => {
  it('should handle rapid sequential changes', () => {
    const doc = createCrdtDocument({ n: 0 }, 'fast');
    for (let i = 1; i <= 100; i++) {
      doc.change((d) => {
        (d as Record<string, unknown>).n = i;
      });
    }

    expect(doc.getState().value.n).toBe(100);
    expect(doc.getState().changes).toHaveLength(100);
    expect(doc.getState().clock).toBe(100);
  });

  it('should handle large object values', () => {
    const largeObj: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      largeObj[`key${i}`] = `value-${i}`;
    }

    const doc = createCrdtDocument(largeObj, 'a');
    doc.change((d) => {
      (d as Record<string, unknown>).key50 = 'modified';
    });

    expect(doc.getState().value.key50).toBe('modified');
    expect(doc.getState().value.key0).toBe('value-0');
    expect(doc.getState().value.key99).toBe('value-99');
  });

  it('should handle deeply nested structures', () => {
    const doc = createCrdtDocument(
      {
        level1: { level2: { level3: { value: 'deep' } } },
      },
      'a'
    );

    doc.change((d) => {
      (d as Record<string, unknown>).level1 = {
        level2: { level3: { value: 'modified-deep' } },
      };
    });

    expect(doc.getState().value.level1.level2.level3.value).toBe('modified-deep');
  });

  it('should handle sync with empty document', () => {
    const docA = createCrdtDocument({}, 'a');
    const docB = createCrdtDocument({}, 'b');

    docA.change((d) => {
      (d as Record<string, unknown>).first = true;
    });

    const msg = docA.generateSyncMessage(docB.getState().heads);
    expect(msg).not.toBeNull();

    const result = docB.receiveSyncMessage(msg!);
    expect(result.success).toBe(true);
    expect(docB.getState().value).toHaveProperty('first', true);
  });

  it('should handle document with boolean, null, and undefined-like values', () => {
    const doc = createCrdtDocument(
      {
        flag: true,
        nullable: null as unknown as string,
        zero: 0,
        empty: '',
      },
      'a'
    );

    doc.change((d) => {
      (d as Record<string, unknown>).flag = false;
      (d as Record<string, unknown>).zero = -1;
    });

    const state = doc.getState().value;
    expect(state.flag).toBe(false);
    expect(state.zero).toBe(-1);
    expect(state.empty).toBe('');
  });

  it('should handle sync session with multiple peers round-trip', () => {
    const localDoc = createCrdtDocument({ v: 0 }, 'local');
    const session = createSyncSession('doc-1', localDoc);
    session.addPeer('peer-a');
    session.addPeer('peer-b');

    localDoc.change((d) => {
      (d as Record<string, unknown>).v = 1;
    });

    // Generate and send to both peers
    const msgA = session.generateMessage('peer-a');
    const msgB = session.generateMessage('peer-b');

    expect(msgA).not.toBeNull();
    expect(msgB).not.toBeNull();
    expect(msgA!.targetId).toBe('peer-a');
    expect(msgB!.targetId).toBe('peer-b');

    // Simulate peer-a responding
    const peerA = createCrdtDocument({ v: 0 }, 'peer-a');
    if (msgA) peerA.receiveSyncMessage(msgA);

    peerA.change((d) => {
      (d as Record<string, unknown>).v = 10;
    });
    const responseFromA = peerA.generateSyncMessage(localDoc.getState().heads);
    if (responseFromA) {
      session.receiveMessage({ ...responseFromA, senderId: 'peer-a', targetId: 'local' });
    }

    expect(localDoc.getState().value.v).toBe(10);

    // peer-b should now have pending changes (local was updated from peer-a)
    const peers = session.getPeerStates();
    const peerBState = peers.find((p) => p.peerId === 'peer-b');
    expect(peerBState?.hasPendingChanges).toBe(true);

    session.destroy();
  });

  it('should handle mergeSyncMessages from multiple sources', () => {
    const target = createCrdtDocument({ a: '', b: '' }, 'target');

    const src1 = createCrdtDocument({ a: '', b: '' }, 'src1');
    const src2 = createCrdtDocument({ a: '', b: '' }, 'src2');

    src1.change((d) => {
      (d as Record<string, unknown>).a = 'from-1';
    });
    src2.change((d) => {
      (d as Record<string, unknown>).b = 'from-2';
    });

    const messages: CrdtSyncMessage[] = [];
    const m1 = src1.generateSyncMessage([]);
    const m2 = src2.generateSyncMessage([]);
    if (m1) messages.push(m1);
    if (m2) messages.push(m2);

    const results = mergeSyncMessages(target, messages);
    expect(results.every((r) => r.success)).toBe(true);
    expect(target.getState().value.a).toBe('from-1');
    expect(target.getState().value.b).toBe('from-2');
  });
});
