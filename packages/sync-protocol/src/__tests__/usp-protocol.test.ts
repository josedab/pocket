import { describe, expect, it } from 'vitest';
import type { MessageHandler } from '../conformance-suite.js';
import { ConformanceSuite } from '../conformance-suite.js';
import type { DocumentChange, HandshakeAckPayload, ProtocolMessage } from '../protocol-spec.js';
import { createMessage, DEFAULT_CAPABILITIES, USP_SPEC_VERSION } from '../protocol-spec.js';
import { USPSyncSession } from '../reference-impl.js';

// ─── Protocol Spec Tests ────────────────────────────────────────

describe('Protocol Spec - createMessage', () => {
  it('should create a message envelope with correct fields', () => {
    const msg = createMessage('handshake', 'node-1', { foo: 'bar' });
    expect(msg.version).toBe(USP_SPEC_VERSION);
    expect(msg.type).toBe('handshake');
    expect(msg.senderId).toBe('node-1');
    expect(msg.payload).toEqual({ foo: 'bar' });
    expect(msg.messageId).toMatch(/^msg_/);
    expect(msg.timestamp).toBeDefined();
    expect(msg.replyTo).toBeUndefined();
  });

  it('should set replyTo when provided', () => {
    const msg = createMessage('ack', 'node-1', {}, 'original-msg-id');
    expect(msg.replyTo).toBe('original-msg-id');
  });

  it('should generate unique message IDs', () => {
    const msg1 = createMessage('ping', 'n', {});
    const msg2 = createMessage('ping', 'n', {});
    expect(msg1.messageId).not.toBe(msg2.messageId);
  });
});

describe('Protocol Spec - DEFAULT_CAPABILITIES', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_CAPABILITIES.deltaSync).toBe(true);
    expect(DEFAULT_CAPABILITIES.conflictResolution).toBe(true);
    expect(DEFAULT_CAPABILITIES.binaryData).toBe(false);
    expect(DEFAULT_CAPABILITIES.maxPayloadSize).toBe(5 * 1024 * 1024);
    expect(DEFAULT_CAPABILITIES.compression).toContain('none');
    expect(DEFAULT_CAPABILITIES.compression).toContain('gzip');
  });
});

// ─── USPSyncSession Tests ───────────────────────────────────────

function createPair(): {
  client: USPSyncSession;
  server: USPSyncSession;
  clientMessages: ProtocolMessage[];
  serverMessages: ProtocolMessage[];
} {
  const clientMessages: ProtocolMessage[] = [];
  const serverMessages: ProtocolMessage[] = [];

  const server = new USPSyncSession({
    nodeId: 'server',
    onSend: (msg) => {
      serverMessages.push(msg);
    },
  });

  const client = new USPSyncSession({
    nodeId: 'client',
    onSend: (msg) => {
      clientMessages.push(msg);
    },
  });

  return { client, server, clientMessages, serverMessages };
}

describe('USPSyncSession - Handshake', () => {
  it('should perform a handshake between client and server', () => {
    const { client, server, clientMessages, serverMessages } = createPair();

    expect(client.getState()).toBe('idle');
    expect(server.getState()).toBe('idle');

    // Client initiates handshake
    client.connect(['users', 'posts']);
    expect(client.getState()).toBe('handshaking');
    expect(clientMessages).toHaveLength(1);
    expect(clientMessages[0].type).toBe('handshake');

    // Server receives handshake
    server.receive(clientMessages[0]);
    expect(server.getState()).toBe('syncing');
    expect(serverMessages).toHaveLength(1);
    expect(serverMessages[0].type).toBe('handshake-ack');

    // Client receives handshake-ack
    client.receive(serverMessages[0]);
    expect(client.getState()).toBe('syncing');
  });

  it('should reject handshake with wrong version', () => {
    const { server, serverMessages } = createPair();

    const badMsg = createMessage('handshake', 'bad-client', {
      protocolVersion: '99.0.0',
      nodeId: 'bad-client',
      capabilities: DEFAULT_CAPABILITIES,
      collections: ['test'],
    });
    badMsg.version = '99.0.0';

    server.receive(badMsg);
    expect(serverMessages).toHaveLength(1);
    expect(serverMessages[0].type).toBe('error');
    expect((serverMessages[0].payload as { code: string }).code).toBe('PROTOCOL_MISMATCH');
  });

  it('should handle rejected handshake-ack', () => {
    const errors: Error[] = [];
    const messages: ProtocolMessage[] = [];
    const client = new USPSyncSession({
      nodeId: 'client',
      onSend: (msg) => messages.push(msg),
      onError: (err) => errors.push(err),
    });

    client.connect(['test']);

    const rejectAck = createMessage<HandshakeAckPayload>('handshake-ack', 'server', {
      accepted: false,
      negotiatedCapabilities: DEFAULT_CAPABILITIES,
      sessionId: '',
      serverTime: new Date().toISOString(),
      reason: 'Auth failed',
    });

    client.receive(rejectAck);
    expect(client.getState()).toBe('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Auth failed');
  });
});

describe('USPSyncSession - Push & Pull', () => {
  function setupConnectedPair() {
    const { client, server, clientMessages, serverMessages } = createPair();
    client.connect(['test']);
    server.receive(clientMessages[0]);
    client.receive(serverMessages[0]);
    clientMessages.length = 0;
    serverMessages.length = 0;
    return { client, server, clientMessages, serverMessages };
  }

  it('should push changes from client to server', () => {
    const { client, server, clientMessages, serverMessages } = setupConnectedPair();
    const receivedChanges: DocumentChange[][] = [];
    server.receivedChanges$.subscribe((changes) => receivedChanges.push(changes));

    const change: DocumentChange = {
      id: 'doc-1',
      collection: 'test',
      operation: 'create',
      data: { name: 'Hello' },
      metadata: {
        revision: 1,
        timestamp: new Date().toISOString(),
        origin: 'client',
        vectorClock: { client: 1 },
      },
    };

    client.push([change]);
    expect(clientMessages).toHaveLength(1);
    expect(clientMessages[0].type).toBe('push');

    server.receive(clientMessages[0]);
    expect(receivedChanges).toHaveLength(1);
    expect(receivedChanges[0][0].id).toBe('doc-1');
    expect(serverMessages).toHaveLength(1);
    expect(serverMessages[0].type).toBe('ack');
  });

  it('should pull changes', () => {
    const { client, server, clientMessages, serverMessages } = setupConnectedPair();

    client.pull(['test'], 10);
    expect(clientMessages).toHaveLength(1);
    expect(clientMessages[0].type).toBe('pull');

    server.receive(clientMessages[0]);
    expect(serverMessages).toHaveLength(1);
    expect(serverMessages[0].type).toBe('pull-response');

    const receivedChanges: DocumentChange[][] = [];
    client.receivedChanges$.subscribe((changes) => receivedChanges.push(changes));

    client.receive(serverMessages[0]);
    expect(receivedChanges).toHaveLength(1);
  });

  it('should throw if pushing before syncing', () => {
    const { client } = createPair();
    expect(() => client.push([])).toThrow('Cannot push: not in syncing state');
  });

  it('should throw if pulling before syncing', () => {
    const { client } = createPair();
    expect(() => client.pull(['test'])).toThrow('Cannot pull: not in syncing state');
  });
});

describe('USPSyncSession - Ping/Pong', () => {
  it('should respond to ping with pong', () => {
    const messages: ProtocolMessage[] = [];
    const session = new USPSyncSession({
      nodeId: 'node-1',
      onSend: (msg) => messages.push(msg),
    });

    const ping = createMessage('ping', 'remote', {});
    session.receive(ping);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('pong');
    expect(messages[0].replyTo).toBe(ping.messageId);
  });
});

describe('USPSyncSession - Checkpoint', () => {
  it('should acknowledge checkpoint messages', () => {
    const messages: ProtocolMessage[] = [];
    const session = new USPSyncSession({
      nodeId: 'node-1',
      onSend: (msg) => messages.push(msg),
    });

    const cp = createMessage('checkpoint', 'remote', {
      sessionId: 'sess-1',
      checkpoint: 'cp-42',
      vectorClock: { remote: 10 },
      collections: ['test'],
    });

    session.receive(cp);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('checkpoint-ack');
    expect((messages[0].payload as { checkpoint: string }).checkpoint).toBe('cp-42');
  });
});

describe('USPSyncSession - State observable', () => {
  it('should emit state changes', () => {
    const { client, server, clientMessages, serverMessages } = createPair();
    const states: string[] = [];
    client.stateChanges$.subscribe((s) => states.push(s));

    client.connect(['test']);
    server.receive(clientMessages[0]);
    client.receive(serverMessages[0]);
    client.close();

    expect(states).toEqual(['handshaking', 'syncing', 'closed']);
  });
});

describe('USPSyncSession - Error handling', () => {
  it('should transition to error state on error message', () => {
    const errors: Error[] = [];
    const messages: ProtocolMessage[] = [];
    const session = new USPSyncSession({
      nodeId: 'node-1',
      onSend: (msg) => messages.push(msg),
      onError: (err) => errors.push(err),
    });

    const errorMsg = createMessage('error', 'remote', {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
      retryable: false,
    });

    session.receive(errorMsg);
    expect(session.getState()).toBe('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('INTERNAL_ERROR');
  });
});

// ─── Conformance Suite Tests ────────────────────────────────────

describe('ConformanceSuite', () => {
  function createReferenceHandler(): MessageHandler {
    const messages: ProtocolMessage[] = [];
    const session = new USPSyncSession({
      nodeId: 'conformance-server',
      onSend: (msg) => messages.push(msg),
    });

    return async (message: ProtocolMessage): Promise<ProtocolMessage | null> => {
      messages.length = 0;
      session.receive(message);
      return messages[0] ?? null;
    };
  }

  it('should pass all conformance tests against reference implementation', async () => {
    const suite = new ConformanceSuite(createReferenceHandler());
    const report = await suite.runAll('reference-impl');

    expect(report.implementation).toBe('reference-impl');
    expect(report.version).toBe(USP_SPEC_VERSION);
    expect(report.totalTests).toBeGreaterThan(0);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(report.totalTests);

    for (const result of report.results) {
      expect(result.passed).toBe(true);
    }
  });

  it('should report failures for a non-compliant handler', async () => {
    const brokenHandler: MessageHandler = async () => null;

    const suite = new ConformanceSuite(brokenHandler);
    const report = await suite.runAll('broken-impl');

    expect(report.failed).toBeGreaterThan(0);
  });
});
