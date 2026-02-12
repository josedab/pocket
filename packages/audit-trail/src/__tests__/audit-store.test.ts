import { describe, it, expect, beforeEach } from 'vitest';
import { AuditStore, createAuditStore } from '../audit-store.js';
import type { AuditEntry } from '../types.js';
import { hashEntry } from '../hash.js';

describe('AuditStore', () => {
  let store: AuditStore;

  beforeEach(() => {
    store = createAuditStore({ algorithm: 'sha-256', batchSize: 10 });
  });

  it('should append entries with hash chaining', () => {
    const e1 = store.append('insert', 'todos', 'doc-1', { title: 'A' });
    const e2 = store.append('update', 'todos', 'doc-1', { title: 'B' });

    expect(e1.previousHash).toBe('0'.repeat(32));
    expect(e2.previousHash).toBe(e1.hash);
    expect(e1.hash).toBeTruthy();
    expect(e2.hash).toBeTruthy();
    expect(store.getEntryCount()).toBe(2);
  });

  it('should query by collection', () => {
    store.append('insert', 'todos', 'doc-1');
    store.append('insert', 'users', 'user-1');
    store.append('update', 'todos', 'doc-1');

    const results = store.query({ collection: 'todos' });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.collection === 'todos')).toBe(true);
  });

  it('should query by time range', () => {
    const e1 = store.append('insert', 'todos', 'doc-1');
    const e2 = store.append('insert', 'todos', 'doc-2');

    // Query for entries at or after e2's timestamp
    const results = store.query({ startTime: e2.timestamp });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((e) => e.id === e2.id)).toBe(true);
  });

  it('should verify single entry integrity', () => {
    const entry = store.append('insert', 'todos', 'doc-1', { title: 'Test' });

    const result = store.verify(entry.id);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.entry?.id).toBe(entry.id);
  });

  it('should verify chain integrity', () => {
    store.append('insert', 'todos', 'doc-1');
    store.append('update', 'todos', 'doc-1');
    store.append('delete', 'todos', 'doc-1');

    const result = store.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect a tampered entry', () => {
    store.append('insert', 'todos', 'doc-1');
    const entry = store.append('update', 'todos', 'doc-1', { title: 'Original' });

    // Tamper with the entry's data directly via internals
    (entry as { data: unknown }).data = { title: 'Tampered' };

    const result = store.verify(entry.id);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Hash mismatch');
  });

  it('should anchor and get result', () => {
    store.append('insert', 'todos', 'doc-1');
    store.append('insert', 'todos', 'doc-2');
    store.append('insert', 'todos', 'doc-3');

    const anchor = store.anchor();
    expect(anchor.merkleRoot).toBeTruthy();
    expect(anchor.batchSize).toBe(3);

    const history = store.getAnchorHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.merkleRoot).toBe(anchor.merkleRoot);
  });

  it('should export audit log', () => {
    store.append('insert', 'todos', 'doc-1');
    store.append('insert', 'users', 'user-1');
    store.append('update', 'todos', 'doc-1');

    const allEntries = store.exportAuditLog();
    expect(allEntries).toHaveLength(3);

    const filtered = store.exportAuditLog({ collection: 'users' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.collection).toBe('users');
  });

  it('should return not found for unknown entry ID', () => {
    const result = store.verify('nonexistent');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });

  it('should handle empty chain verification', () => {
    const result = store.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should anchor empty batch gracefully', () => {
    const anchor = store.anchor();
    expect(anchor.merkleRoot).toBe('');
    expect(anchor.batchSize).toBe(0);
  });
});
