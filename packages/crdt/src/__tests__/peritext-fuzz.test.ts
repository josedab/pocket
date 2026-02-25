/**
 * Property-based fuzz tests for Peritext CRDT convergence.
 *
 * Verifies the fundamental CRDT invariants:
 * 1. Convergence: all replicas with the same ops produce the same state
 * 2. Commutativity: order of applying remote ops doesn't matter
 * 3. Idempotency: applying the same op twice has no additional effect
 * 4. Causality: insert-then-delete preserves causality
 */
import { describe, expect, it } from 'vitest';
import type { PeritextOp } from '../peritext.js';
import { createPeritextDocument } from '../peritext.js';

// Seeded pseudo-random for reproducibility
function createRng(seed: number) {
  let s = seed;
  return {
    next(): number {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    },
    nextInt(max: number): number {
      return Math.floor(this.next() * max);
    },
    pick<T>(arr: T[]): T {
      return arr[this.nextInt(arr.length)]!;
    },
  };
}

function randomString(rng: ReturnType<typeof createRng>, maxLen: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  const len = rng.nextInt(maxLen) + 1;
  let result = '';
  for (let i = 0; i < len; i++) {
    result += rng.pick(chars.split(''));
  }
  return result;
}

describe('Peritext CRDT Fuzz Tests', () => {
  describe('Convergence', () => {
    it('should converge after random concurrent inserts (100 trials)', () => {
      for (let trial = 0; trial < 100; trial++) {
        const rng = createRng(trial * 7 + 42);
        const doc1 = createPeritextDocument('alice');
        const doc2 = createPeritextDocument('bob');

        // Start with shared base text
        const baseOps = doc1.insert(0, 'base');
        for (const op of baseOps) doc2.applyRemoteOp(op);

        // Each side does random inserts
        const aliceOps: PeritextOp[] = [];
        const bobOps: PeritextOp[] = [];

        const numOps = rng.nextInt(5) + 1;

        for (let i = 0; i < numOps; i++) {
          const pos = rng.nextInt(doc1.length + 1);
          const text = randomString(rng, 3);
          aliceOps.push(...doc1.insert(pos, text));
        }

        for (let i = 0; i < numOps; i++) {
          const pos = rng.nextInt(doc2.length + 1);
          const text = randomString(rng, 3);
          bobOps.push(...doc2.insert(pos, text));
        }

        // Apply remote ops
        for (const op of bobOps) doc1.applyRemoteOp(op);
        for (const op of aliceOps) doc2.applyRemoteOp(op);

        // INVARIANT: Both documents must have identical text
        expect(doc1.getText()).toBe(doc2.getText());
      }
    });

    it('should converge after random inserts + deletes (50 trials)', () => {
      for (let trial = 0; trial < 50; trial++) {
        const rng = createRng(trial * 13 + 99);
        const doc1 = createPeritextDocument('alice');
        const doc2 = createPeritextDocument('bob');

        // Shared base
        const baseOps = doc1.insert(0, 'ABCDEF');
        for (const op of baseOps) doc2.applyRemoteOp(op);

        const aliceOps: PeritextOp[] = [];
        const bobOps: PeritextOp[] = [];

        // Alice: random mix of inserts and deletes
        for (let i = 0; i < 3; i++) {
          if (rng.next() > 0.5 && doc1.length > 0) {
            const pos = rng.nextInt(doc1.length);
            const len = rng.nextInt(Math.min(3, doc1.length - pos)) + 1;
            aliceOps.push(...doc1.delete(pos, len));
          } else {
            const pos = rng.nextInt(doc1.length + 1);
            aliceOps.push(...doc1.insert(pos, randomString(rng, 2)));
          }
        }

        // Bob: random mix of inserts and deletes
        for (let i = 0; i < 3; i++) {
          if (rng.next() > 0.5 && doc2.length > 0) {
            const pos = rng.nextInt(doc2.length);
            const len = rng.nextInt(Math.min(3, doc2.length - pos)) + 1;
            bobOps.push(...doc2.delete(pos, len));
          } else {
            const pos = rng.nextInt(doc2.length + 1);
            bobOps.push(...doc2.insert(pos, randomString(rng, 2)));
          }
        }

        // Apply remote ops
        for (const op of bobOps) doc1.applyRemoteOp(op);
        for (const op of aliceOps) doc2.applyRemoteOp(op);

        // INVARIANT: Convergence
        expect(doc1.getText()).toBe(doc2.getText());
      }
    });
  });

  describe('Idempotency', () => {
    it('should be idempotent: applying same ops twice has no effect (50 trials)', () => {
      for (let trial = 0; trial < 50; trial++) {
        const rng = createRng(trial * 11 + 17);
        const doc = createPeritextDocument('node-1');

        doc.insert(0, 'Hello');
        const ops = doc.flushOps();

        // Create a second doc and apply ops
        const doc2 = createPeritextDocument('node-2');
        for (const op of ops) doc2.applyRemoteOp(op);

        const textBefore = doc2.getText();

        // Apply same ops again
        for (const op of ops) doc2.applyRemoteOp(op);

        const textAfter = doc2.getText();

        // INVARIANT: Text unchanged after re-application
        expect(textAfter).toBe(textBefore);
      }
    });
  });

  describe('Commutativity', () => {
    it('should be commutative: op order does not matter (50 trials)', () => {
      for (let trial = 0; trial < 50; trial++) {
        const rng = createRng(trial * 23 + 5);
        const doc1 = createPeritextDocument('node-1');
        const doc2 = createPeritextDocument('node-2');

        // Generate ops from two sources
        const aOps = doc1.insert(0, randomString(rng, 4));
        const bOps = doc2.insert(0, randomString(rng, 4));

        // Apply in different orders
        const docForward = createPeritextDocument('verifier-1');
        for (const op of aOps) docForward.applyRemoteOp(op);
        for (const op of bOps) docForward.applyRemoteOp(op);

        const docReverse = createPeritextDocument('verifier-2');
        for (const op of bOps) docReverse.applyRemoteOp(op);
        for (const op of aOps) docReverse.applyRemoteOp(op);

        // INVARIANT: Same result regardless of order
        expect(docForward.getText()).toBe(docReverse.getText());
      }
    });
  });

  describe('Causality', () => {
    it('should preserve delete after insert (50 trials)', () => {
      for (let trial = 0; trial < 50; trial++) {
        const rng = createRng(trial * 31 + 77);
        const doc = createPeritextDocument('node-1');

        const text = randomString(rng, 8);
        doc.insert(0, text);

        const deleteStart = rng.nextInt(text.length);
        const deleteLen = rng.nextInt(text.length - deleteStart) + 1;
        doc.delete(deleteStart, deleteLen);

        const result = doc.getText();

        // INVARIANT: Deleted characters are gone
        const expected = text.slice(0, deleteStart) + text.slice(deleteStart + deleteLen);
        expect(result).toBe(expected);
      }
    });
  });

  describe('Three-way merge', () => {
    it('should converge with 3 concurrent replicas (30 trials)', () => {
      for (let trial = 0; trial < 30; trial++) {
        const rng = createRng(trial * 37 + 111);

        const docs = [
          createPeritextDocument('alice'),
          createPeritextDocument('bob'),
          createPeritextDocument('carol'),
        ];

        // Shared base
        const baseOps = docs[0]!.insert(0, 'XYZ');
        for (const doc of docs.slice(1)) {
          for (const op of baseOps) doc.applyRemoteOp(op);
        }

        // Each replica does a random insert
        const allOps: PeritextOp[][] = [];
        for (const doc of docs) {
          const pos = rng.nextInt(doc.length + 1);
          const text = randomString(rng, 2);
          allOps.push([...doc.insert(pos, text)]);
        }

        // Apply all remote ops to all replicas
        for (let i = 0; i < docs.length; i++) {
          for (let j = 0; j < docs.length; j++) {
            if (i === j) continue;
            for (const op of allOps[j]!) {
              docs[i]!.applyRemoteOp(op);
            }
          }
        }

        // INVARIANT: All three replicas converge
        const texts = docs.map((d) => d.getText());
        expect(texts[0]).toBe(texts[1]);
        expect(texts[1]).toBe(texts[2]);
      }
    });
  });

  describe('Formatting under concurrent edits', () => {
    it('should preserve formatting marks through concurrent inserts (30 trials)', () => {
      for (let trial = 0; trial < 30; trial++) {
        const rng = createRng(trial * 43 + 200);
        const doc1 = createPeritextDocument('alice');
        const doc2 = createPeritextDocument('bob');

        // Shared base
        const baseOps = doc1.insert(0, 'ABCDEF');
        for (const op of baseOps) doc2.applyRemoteOp(op);

        // Alice formats a range
        const fmtOp = doc1.format(0, 3, 'bold');

        // Bob inserts concurrently
        const bobOps = doc2.insert(2, 'X');

        // Apply remote ops
        doc1.applyRemoteOp(fmtOp);
        for (const op of bobOps) doc1.applyRemoteOp(op);
        doc2.applyRemoteOp(fmtOp);

        // INVARIANT: Both converge
        expect(doc1.getText()).toBe(doc2.getText());

        // INVARIANT: Formatting exists in snapshot
        const snapshot = doc1.getSnapshot();
        const hasBold = snapshot.spans.some((s) => s.marks.some((m) => m.type === 'bold'));
        expect(hasBold).toBe(true);
      }
    });
  });
});
