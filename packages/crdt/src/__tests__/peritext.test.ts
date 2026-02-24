import { describe, expect, it } from 'vitest';
import { createPeritextDocument } from '../peritext.js';

describe('PeritextDocument', () => {
  it('should insert text', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Hello');
    expect(doc.getText()).toBe('Hello');
    expect(doc.length).toBe(5);
  });

  it('should insert text at specific position', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Helo');
    doc.insert(2, 'l');
    expect(doc.getText()).toBe('Hello');
  });

  it('should delete text', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Hello World');
    doc.delete(5, 6); // delete " World"
    expect(doc.getText()).toBe('Hello');
  });

  it('should apply formatting marks', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Hello World');
    doc.format(0, 5, 'bold');

    const snapshot = doc.getSnapshot();
    expect(snapshot.text).toBe('Hello World');
    expect(snapshot.spans.length).toBeGreaterThanOrEqual(1);

    const boldSpan = snapshot.spans.find((s) => s.marks.some((m) => m.type === 'bold'));
    expect(boldSpan).toBeDefined();
    expect(boldSpan!.text).toBe('Hello');
  });

  it('should unformat (remove) marks', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Bold text');
    const op = doc.format(0, 4, 'bold');

    if (op.type === 'format') {
      doc.unformat(op.mark.id);
      const snapshot = doc.getSnapshot();
      const boldSpans = snapshot.spans.filter((s) => s.marks.some((m) => m.type === 'bold'));
      expect(boldSpans).toHaveLength(0);
    }
  });

  it('should handle multiple format types', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Styled');
    doc.format(0, 6, 'bold');
    doc.format(0, 6, 'italic');

    const snapshot = doc.getSnapshot();
    const span = snapshot.spans[0]!;
    expect(span.marks).toHaveLength(2);
    expect(span.marks.map((m) => m.type).sort()).toEqual(['bold', 'italic']);
  });

  it('should handle link marks with values', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Click here');
    doc.format(0, 10, 'link', 'https://example.com');

    const snapshot = doc.getSnapshot();
    const linkSpan = snapshot.spans.find((s) => s.marks.some((m) => m.type === 'link'));
    expect(linkSpan).toBeDefined();
    expect(linkSpan!.marks[0]!.value).toBe('https://example.com');
  });

  it('should merge concurrent inserts deterministically', () => {
    const doc1 = createPeritextDocument('alice');
    const doc2 = createPeritextDocument('bob');

    // Both start with same text
    const insertOps = doc1.insert(0, 'AB');
    for (const op of insertOps) {
      doc2.applyRemoteOp(op);
    }
    expect(doc1.getText()).toBe('AB');
    expect(doc2.getText()).toBe('AB');

    // Alice inserts X at position 1 (between A and B)
    const aliceOps = doc1.insert(1, 'X');
    // Bob inserts Y at position 1 (between A and B)
    const bobOps = doc2.insert(1, 'Y');

    // Apply remote ops to both
    for (const op of bobOps) doc1.applyRemoteOp(op);
    for (const op of aliceOps) doc2.applyRemoteOp(op);

    // Both must converge to the exact same text (order may vary but must be consistent)
    expect(doc1.getText()).toBe(doc2.getText());
    // All characters present
    expect(doc1.getText()).toContain('A');
    expect(doc1.getText()).toContain('B');
    expect(doc1.getText()).toContain('X');
    expect(doc1.getText()).toContain('Y');
    expect(doc1.length).toBe(4);
  });

  it('should handle concurrent delete and insert', () => {
    const doc1 = createPeritextDocument('alice');
    const doc2 = createPeritextDocument('bob');

    const ops = doc1.insert(0, 'ABC');
    for (const op of ops) doc2.applyRemoteOp(op);

    // Alice deletes B
    const deleteOps = doc1.delete(1, 1);
    // Bob inserts X after A
    const insertOps = doc2.insert(1, 'X');

    for (const op of insertOps) doc1.applyRemoteOp(op);
    for (const op of deleteOps) doc2.applyRemoteOp(op);

    // Both should converge
    expect(doc1.getText()).toBe(doc2.getText());
    // Should contain A, X, C but not B
    expect(doc1.getText()).toContain('A');
    expect(doc1.getText()).toContain('X');
    expect(doc1.getText()).toContain('C');
    expect(doc1.getText()).not.toContain('B');
  });

  it('should flush pending operations', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'Hi');
    const ops = doc.flushOps();
    expect(ops).toHaveLength(2); // 2 character inserts
    expect(doc.flushOps()).toHaveLength(0);
  });

  it('should produce correct snapshot structure', () => {
    const doc = createPeritextDocument('node-1');
    doc.insert(0, 'AB');
    doc.format(0, 1, 'bold'); // just 'A' is bold

    const snapshot = doc.getSnapshot();
    expect(snapshot.text).toBe('AB');
    expect(snapshot.length).toBe(2);
    expect(snapshot.spans.length).toBe(2); // 'A' (bold) + 'B' (plain)
  });

  it('should handle empty document', () => {
    const doc = createPeritextDocument('node-1');
    const snapshot = doc.getSnapshot();
    expect(snapshot.text).toBe('');
    expect(snapshot.spans).toHaveLength(0);
    expect(snapshot.length).toBe(0);
  });
});
