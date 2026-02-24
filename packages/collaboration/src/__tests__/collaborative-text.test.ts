import { describe, expect, it } from 'vitest';
import { CollaborativeTextEngine } from '../collaborative-text.js';

describe('CollaborativeTextEngine', () => {
  it('should initialize with text', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hello',
    });
    expect(engine.getText()).toBe('Hello');
    expect(engine.getVersion()).toBe(0);
    engine.destroy();
  });

  it('should insert text', () => {
    const engine = new CollaborativeTextEngine({ documentId: 'd1', userId: 'u1' });
    engine.insert(0, 'Hello');
    expect(engine.getText()).toBe('Hello');
    engine.insert(5, ' World');
    expect(engine.getText()).toBe('Hello World');
    engine.destroy();
  });

  it('should delete text', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hello World',
    });
    engine.delete(5, 6);
    expect(engine.getText()).toBe('Hello');
    engine.destroy();
  });

  it('should replace text', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hello World',
    });
    engine.replace(6, 5, 'Pocket');
    expect(engine.getText()).toBe('Hello Pocket');
    engine.destroy();
  });

  it('should apply remote operations', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hello',
    });
    engine.applyRemote({
      type: 'insert',
      position: 5,
      text: '!',
      userId: 'u2',
      timestamp: Date.now(),
    });
    expect(engine.getText()).toBe('Hello!');
    engine.destroy();
  });

  it('should track version numbers', () => {
    const engine = new CollaborativeTextEngine({ documentId: 'd1', userId: 'u1' });
    engine.insert(0, 'a');
    engine.insert(1, 'b');
    engine.delete(0, 1);
    expect(engine.getVersion()).toBe(3);
    engine.destroy();
  });

  it('should manage cursor positions', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hello',
    });
    engine.setCursor(3);
    engine.setRemoteCursor('u2', 5);

    const cursors = engine.getCursors();
    expect(cursors).toHaveLength(2);
    expect(cursors.find((c) => c.userId === 'u1')!.position).toBe(3);
    expect(cursors.find((c) => c.userId === 'u2')!.position).toBe(5);
    engine.destroy();
  });

  it('should adjust cursors on insert', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hello',
    });
    engine.setCursor(3);
    engine.setRemoteCursor('u2', 5);

    engine.insert(0, 'XX'); // insert before both cursors
    const cursors = engine.getCursors();
    expect(cursors.find((c) => c.userId === 'u1')!.position).toBe(5); // shifted by 2
    expect(cursors.find((c) => c.userId === 'u2')!.position).toBe(7);
    engine.destroy();
  });

  it('should emit changes via observable', () => {
    const engine = new CollaborativeTextEngine({ documentId: 'd1', userId: 'u1' });
    const ops: string[] = [];
    engine.changes$.subscribe((op) => ops.push(op.type));

    engine.insert(0, 'Hi');
    engine.delete(0, 1);

    expect(ops).toEqual(['insert', 'delete']);
    engine.destroy();
  });

  it('should throw on out-of-bounds insert', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hi',
    });
    expect(() => engine.insert(10, 'x')).toThrow('out of bounds');
    engine.destroy();
  });

  it('should undo last local insert', () => {
    const engine = new CollaborativeTextEngine({
      documentId: 'd1',
      userId: 'u1',
      initialText: 'Hello',
    });
    engine.insert(5, '!!!');
    expect(engine.getText()).toBe('Hello!!!');

    engine.undo();
    expect(engine.getText()).toBe('Hello');
    engine.destroy();
  });

  it('should track operation history', () => {
    const engine = new CollaborativeTextEngine({ documentId: 'd1', userId: 'u1' });
    engine.insert(0, 'abc');
    engine.delete(1, 1);

    expect(engine.getHistory()).toHaveLength(2);
    engine.destroy();
  });

  it('should enforce max length', () => {
    const engine = new CollaborativeTextEngine({ documentId: 'd1', userId: 'u1', maxLength: 5 });
    engine.insert(0, 'Hello');
    expect(() => engine.insert(5, 'X')).toThrow('max length');
    engine.destroy();
  });
});
