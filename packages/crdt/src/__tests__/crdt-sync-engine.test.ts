import { describe, expect, it } from 'vitest';
import { CRDTSyncEngine } from '../crdt-sync-engine.js';

describe('CRDTSyncEngine', () => {
  const fields = [
    { field: 'title', type: 'lww-register' as const },
    { field: 'viewCount', type: 'g-counter' as const },
    { field: 'score', type: 'pn-counter' as const },
    { field: 'tags', type: 'or-set' as const },
    { field: 'metadata', type: 'lww-map' as const },
  ];

  it('should apply LWW register operations', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    engine.apply('doc-1', 'title', 'set', 'Hello');
    engine.apply('doc-1', 'title', 'set', 'World');

    const state = engine.getDocumentState('doc-1');
    expect(state.title).toBe('World');
    engine.destroy();
  });

  it('should handle grow-only counter', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    engine.apply('doc-1', 'viewCount', 'increment', 1);
    engine.apply('doc-1', 'viewCount', 'increment', 5);

    expect(engine.getDocumentState('doc-1').viewCount).toBe(6);
    engine.destroy();
  });

  it('should handle positive-negative counter', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    engine.apply('doc-1', 'score', 'increment', 10);
    engine.apply('doc-1', 'score', 'decrement', -3);

    expect(engine.getDocumentState('doc-1').score).toBe(7);
    engine.destroy();
  });

  it('should handle observed-remove set', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    engine.apply('doc-1', 'tags', 'add', 'typescript');
    engine.apply('doc-1', 'tags', 'add', 'database');
    engine.apply('doc-1', 'tags', 'remove', 'database');

    const state = engine.getDocumentState('doc-1');
    expect(state.tags).toEqual(['typescript']);
    engine.destroy();
  });

  it('should handle LWW map', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    engine.apply('doc-1', 'metadata', 'set', { color: 'blue' });
    engine.apply('doc-1', 'metadata', 'set', { size: 'large' });

    const state = engine.getDocumentState('doc-1');
    const meta = state.metadata as Record<string, string>;
    expect(meta.color).toBe('blue');
    expect(meta.size).toBe('large');
    engine.destroy();
  });

  it('should merge remote operations', () => {
    const engine1 = new CRDTSyncEngine({ nodeId: 'n1', fields });
    const engine2 = new CRDTSyncEngine({ nodeId: 'n2', fields });

    engine1.apply('doc-1', 'viewCount', 'increment', 3);
    engine2.apply('doc-1', 'viewCount', 'increment', 5);

    const ops = engine2.getOperationLog();
    const result = engine1.mergeRemote('n2', ops);

    expect(result.merged).toBe(true);
    expect(result.conflicts).toBe(0); // CRDTs are conflict-free
    expect(engine1.getDocumentState('doc-1').viewCount).toBe(8);

    engine1.destroy();
    engine2.destroy();
  });

  it('should resolve LWW register conflicts by timestamp', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    engine.apply('doc-1', 'title', 'set', 'Old Title');

    // Remote operation with later timestamp wins
    const remoteOp = {
      id: 'remote_1',
      documentId: 'doc-1',
      field: 'title',
      type: 'lww-register' as const,
      nodeId: 'n2',
      timestamp: Date.now() + 1000,
      value: 'New Title',
      operation: 'set' as const,
    };

    engine.mergeRemote('n2', [remoteOp]);
    expect(engine.getDocumentState('doc-1').title).toBe('New Title');
    engine.destroy();
  });

  it('should get operations since a timestamp', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    const before = Date.now() - 1;
    engine.apply('doc-1', 'title', 'set', 'A');
    engine.apply('doc-1', 'viewCount', 'increment', 1);

    const ops = engine.getOperationsSince(before);
    expect(ops).toHaveLength(2);
    engine.destroy();
  });

  it('should emit events on operations', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    const events: string[] = [];
    engine.events$.subscribe((e) => events.push(e.type));

    engine.apply('doc-1', 'title', 'set', 'Test');
    expect(events).toContain('local:applied');
    engine.destroy();
  });

  it('should throw for unconfigured fields', () => {
    const engine = new CRDTSyncEngine({ nodeId: 'n1', fields });
    expect(() => engine.apply('doc-1', 'unknown_field', 'set', 'x')).toThrow('not configured');
    engine.destroy();
  });
});
