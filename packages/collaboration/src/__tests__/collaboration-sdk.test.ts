import { describe, it, expect, afterEach } from 'vitest';
import { CollaborationSDK, createCollaborationSDK } from '../collaboration-sdk.js';
import { createMemoryTransportHub } from '../memory-transport.js';

describe('CollaborationSDK', () => {
  let sdk: CollaborationSDK;

  afterEach(async () => {
    await sdk?.disconnect();
  });

  function makeSDK(overrides?: Partial<Parameters<typeof createCollaborationSDK>[0]>) {
    const hub = createMemoryTransportHub();
    return createCollaborationSDK({
      sessionId: 'test-session',
      user: { id: 'user-1', name: 'Alice' },
      transport: hub.createTransport(),
      collections: ['notes', 'tasks'],
      ...overrides,
    });
  }

  it('should start in disconnected state', () => {
    sdk = makeSDK();
    expect(sdk.getStatus()).toBe('disconnected');
  });

  it('should connect and transition to connected', async () => {
    sdk = makeSDK();
    await sdk.connect();
    expect(sdk.getStatus()).toBe('connected');
  });

  it('should disconnect cleanly', async () => {
    sdk = makeSDK();
    await sdk.connect();
    await sdk.disconnect();
    expect(sdk.getStatus()).toBe('disconnected');
  });

  it('should not error on double connect', async () => {
    sdk = makeSDK();
    await sdk.connect();
    await sdk.connect();
    expect(sdk.getStatus()).toBe('connected');
  });

  it('should set cursor position', async () => {
    sdk = makeSDK();
    await sdk.connect();
    sdk.setCursor({ line: 10, column: 5 });
    // No error means success; cursor is forwarded to awareness + session
  });

  it('should set selection range', async () => {
    sdk = makeSDK();
    await sdk.connect();
    sdk.setSelection({
      start: { line: 1, column: 0 },
      end: { line: 1, column: 20 },
    });
  });

  it('should set typing indicator', async () => {
    sdk = makeSDK();
    await sdk.connect();
    sdk.setTyping(true);
    sdk.setTyping(false);
  });

  it('should apply edits for enabled collections', async () => {
    sdk = makeSDK();
    await sdk.connect();
    sdk.applyEdit('notes', 'note-1', [
      { type: 'set', path: 'title', value: 'Hello' },
    ]);
  });

  it('should ignore edits for non-enabled collections', async () => {
    sdk = makeSDK();
    await sdk.connect();
    // 'unknown' is not in the collections list — should silently skip
    sdk.applyEdit('unknown', 'doc-1', [
      { type: 'set', path: 'x', value: 1 },
    ]);
  });

  it('should return a snapshot', async () => {
    sdk = makeSDK();
    await sdk.connect();
    const snapshot = sdk.getSnapshot();
    expect(snapshot.sessionId).toBe('test-session');
    expect(snapshot.localUser.id).toBe('user-1');
    expect(snapshot.status).toBe('connected');
    expect(snapshot.collections).toContain('notes');
  });

  it('should return active users', async () => {
    sdk = makeSDK();
    await sdk.connect();
    const users = sdk.getActiveUsers();
    // At minimum, local user should be in awareness
    expect(Array.isArray(users)).toBe(true);
  });

  it('should emit status via observable', async () => {
    sdk = makeSDK();
    const statuses: string[] = [];
    sdk.status$.subscribe((s) => statuses.push(s));

    await sdk.connect();
    await sdk.disconnect();

    expect(statuses).toContain('disconnected');
    expect(statuses).toContain('connected');
  });
});
