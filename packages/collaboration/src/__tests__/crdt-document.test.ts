import { firstValueFrom, skip } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CRDTDocument, createCRDTDocument } from '../crdt-document.js';
import type { MemoryTransportHub } from '../memory-transport.js';
import { createMemoryTransportHub } from '../memory-transport.js';

describe('CRDTDocument', () => {
  let hub: MemoryTransportHub;
  let docA: CRDTDocument;
  let docB: CRDTDocument;

  beforeEach(async () => {
    hub = createMemoryTransportHub();

    const transportA = hub.createTransport();
    const transportB = hub.createTransport();

    await transportA.connect();
    await transportB.connect();

    docA = createCRDTDocument({
      documentId: 'doc-1',
      clientId: 'alice',
      transport: transportA,
      sessionId: 'session-1',
      batchIntervalMs: 5,
    });

    docB = createCRDTDocument({
      documentId: 'doc-1',
      clientId: 'bob',
      transport: transportB,
      sessionId: 'session-1',
      batchIntervalMs: 5,
    });
  });

  afterEach(() => {
    docA.destroy();
    docB.destroy();
  });

  // ── Field Operations ──────────────────────────────────

  it('should set and get fields', () => {
    docA.setField('title', 'Hello');
    expect(docA.getField('title')).toBe('Hello');
  });

  it('should delete fields', () => {
    docA.setField('title', 'Hello');
    docA.deleteField('title');
    expect(docA.getField('title')).toBeUndefined();
  });

  it('should replicate field changes to remote peer', async () => {
    const remoteOpsPromise = firstValueFrom(docB.remoteOperations$);
    docA.setField('title', 'Shared Title');

    // Wait for batch flush
    await new Promise((r) => setTimeout(r, 20));
    const ops = await remoteOpsPromise;
    expect(ops.length).toBe(1);
    expect(ops[0]!.type).toBe('map-set');
    expect(docB.getField('title')).toBe('Shared Title');
  });

  // ── Text Operations ───────────────────────────────────

  it('should insert text at position', () => {
    docA.insertText('body', 0, 'Hello');
    expect(docA.getText('body')).toBe('Hello');

    docA.insertText('body', 5, ' World');
    expect(docA.getText('body')).toBe('Hello World');
  });

  it('should delete text at position', () => {
    docA.insertText('body', 0, 'Hello World');
    docA.deleteText('body', 5, 6);
    expect(docA.getText('body')).toBe('Hello');
  });

  it('should handle text insert at beginning', () => {
    docA.insertText('body', 0, 'World');
    docA.insertText('body', 0, 'Hello ');
    expect(docA.getText('body')).toBe('Hello World');
  });

  // ── Array Operations ──────────────────────────────────

  it('should insert array elements', () => {
    docA.insertArrayElement('items', 0, 'first');
    docA.insertArrayElement('items', 1, 'second');
    expect(docA.getArray('items')).toEqual(['first', 'second']);
  });

  it('should delete array elements', () => {
    docA.insertArrayElement('items', 0, 'a');
    docA.insertArrayElement('items', 1, 'b');
    docA.insertArrayElement('items', 2, 'c');
    docA.deleteArrayElement('items', 1);
    expect(docA.getArray('items')).toEqual(['a', 'c']);
  });

  // ── Snapshot & Restore ────────────────────────────────

  it('should create and restore snapshots', () => {
    docA.setField('title', 'Test');
    docA.insertText('body', 0, 'Content');
    docA.insertArrayElement('tags', 0, 'tag1');

    const snap = docA.snapshot();

    expect(snap.documentId).toBe('doc-1');
    expect(snap.fields).toEqual({ title: 'Test' });
    expect(snap.texts).toEqual({ body: 'Content' });
    expect(snap.arrays).toEqual({ tags: ['tag1'] });
    expect(snap.version).toBeGreaterThan(0);

    // Restore into a fresh document
    const docC = createCRDTDocument({
      documentId: 'doc-1',
      clientId: 'charlie',
      transport: hub.createTransport(),
      sessionId: 'session-1',
    });
    docC.applySnapshot(snap);
    expect(docC.getField('title')).toBe('Test');
    expect(docC.getText('body')).toBe('Content');
    expect(docC.getArray('tags')).toEqual(['tag1']);
    docC.destroy();
  });

  // ── State Observable ──────────────────────────────────

  it('should emit state updates via state$', async () => {
    const statePromise = firstValueFrom(docA.state$.pipe(skip(1)));
    docA.setField('x', 42);
    const state = await statePromise;
    expect(state.fields.get('x')).toBe(42);
    expect(state.version).toBe(1);
  });

  // ── Vector Clock ──────────────────────────────────────

  it('should increment vector clock on each operation', () => {
    docA.setField('a', 1);
    docA.setField('b', 2);
    const clock = docA.state.clock;
    expect(clock['alice']).toBe(2);
  });

  // ── Lifecycle ─────────────────────────────────────────

  it('should throw after destroy', () => {
    docA.destroy();
    expect(() => docA.setField('x', 1)).toThrow('destroyed');
  });

  it('should ignore messages from different session', async () => {
    const transportC = hub.createTransport();
    await transportC.connect();

    const otherDoc = createCRDTDocument({
      documentId: 'doc-1',
      clientId: 'eve',
      transport: transportC,
      sessionId: 'other-session',
      batchIntervalMs: 5,
    });
    otherDoc.setField('title', 'Evil');

    await new Promise((r) => setTimeout(r, 20));
    expect(docA.getField('title')).toBeUndefined();
    otherDoc.destroy();
  });
});
