import { describe, expect, it } from 'vitest';
import type { ServerAdapter } from '../conformance.js';
import {
  createConformanceSuite,
  createHandshake,
  createPull,
  createPush,
  USP_PROTOCOL_ID,
  USP_VERSION,
  validateChangeRecord,
  validateEnvelope,
  validateHandshake,
  validateMessage,
  validatePull,
  validatePush,
} from '../index.js';
import type {
  HandshakeAckMessage,
  PullResponseMessage,
  PushAckMessage,
  USPMessage,
} from '../types.js';

describe('USP Protocol Constants', () => {
  it('should export version and protocol id', () => {
    expect(USP_VERSION).toBe('1.0.0');
    expect(USP_PROTOCOL_ID).toBe('usp');
  });
});

describe('Message Factories', () => {
  it('should create a valid handshake message', () => {
    const msg = createHandshake('node-1', ['todos', 'notes'], ['push', 'pull']);
    expect(msg.protocol).toBe('usp');
    expect(msg.type).toBe('handshake');
    expect(msg.payload.nodeId).toBe('node-1');
    expect(msg.payload.collections).toEqual(['todos', 'notes']);
  });

  it('should create a valid push message', () => {
    const msg = createPush(
      'sess-1',
      [
        {
          collection: 'todos',
          documentId: 'doc-1',
          operation: 'insert',
          timestamp: Date.now(),
          nodeId: 'n1',
          vclock: { n1: 1 },
        },
      ],
      'cp-0'
    );
    expect(msg.type).toBe('push');
    expect(msg.payload.changes).toHaveLength(1);
  });

  it('should create a valid pull message', () => {
    const msg = createPull('sess-1', 'cp-5', ['todos']);
    expect(msg.type).toBe('pull');
    expect(msg.payload.checkpoint).toBe('cp-5');
  });
});

describe('Validators', () => {
  it('should validate a correct envelope', () => {
    const msg = createHandshake('n1', ['col'], []);
    expect(validateEnvelope(msg).valid).toBe(true);
  });

  it('should reject non-object messages', () => {
    expect(validateEnvelope(null).valid).toBe(false);
    expect(validateEnvelope('string').valid).toBe(false);
  });

  it('should reject invalid protocol', () => {
    const result = validateEnvelope({
      protocol: 'wrong',
      version: '1.0.0',
      type: 'ping',
      id: '1',
      timestamp: Date.now(),
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('protocol');
  });

  it('should validate handshake payload', () => {
    const msg = createHandshake('n1', ['todos'], ['push']);
    expect(validateHandshake(msg).valid).toBe(true);
  });

  it('should reject handshake with empty collections', () => {
    const msg = createHandshake('n1', [], ['push']);
    expect(validateHandshake(msg).valid).toBe(false);
  });

  it('should validate change records', () => {
    expect(
      validateChangeRecord({
        collection: 'todos',
        documentId: 'doc-1',
        operation: 'insert',
        timestamp: Date.now(),
        nodeId: 'n1',
        vclock: { n1: 1 },
      }).valid
    ).toBe(true);
  });

  it('should reject invalid change records', () => {
    expect(validateChangeRecord({}).valid).toBe(false);
    expect(
      validateChangeRecord({
        collection: 'todos',
        documentId: 'doc-1',
        operation: 'invalid-op',
        timestamp: Date.now(),
        nodeId: 'n1',
        vclock: {},
      }).valid
    ).toBe(false);
  });

  it('should validate push messages with nested changes', () => {
    const msg = createPush(
      's1',
      [
        {
          collection: 'todos',
          documentId: 'd1',
          operation: 'update',
          timestamp: Date.now(),
          nodeId: 'n1',
          vclock: { n1: 2 },
        },
      ],
      'cp-1'
    );
    expect(validatePush(msg).valid).toBe(true);
  });

  it('should validate pull messages', () => {
    const msg = createPull('s1', 'cp-0');
    expect(validatePull(msg).valid).toBe(true);
  });

  it('should dispatch validation by message type', () => {
    const hs = createHandshake('n1', ['todos'], []);
    expect(validateMessage(hs).valid).toBe(true);

    const push = createPush('s1', [], 'cp');
    expect(validateMessage(push).valid).toBe(true);
  });
});

describe('ConformanceSuite', () => {
  function createMockAdapter(): ServerAdapter {
    return {
      async send(msg: USPMessage): Promise<USPMessage> {
        const base = {
          protocol: 'usp' as const,
          version: '1.0.0',
          id: `resp-${msg.id}`,
          timestamp: Date.now(),
        };

        switch (msg.type) {
          case 'handshake':
            return {
              ...base,
              type: 'handshake-ack',
              payload: {
                sessionId: 'sess-123',
                serverNodeId: 'server-1',
                acceptedCollections: msg.payload.collections as string[],
                serverCapabilities: ['push', 'pull'],
                checkpoint: 'cp-0',
              },
            } as HandshakeAckMessage;
          case 'push': {
            const pushPayload = (
              msg as { payload?: { sessionId?: string; changes?: Array<{ documentId: string }> } }
            ).payload;
            if (!pushPayload?.changes) {
              return {
                ...base,
                type: 'error',
                payload: { code: 'INVALID_MESSAGE', message: 'Missing payload', retryable: false },
              } as USPMessage;
            }
            return {
              ...base,
              type: 'push-ack',
              payload: {
                sessionId: pushPayload.sessionId,
                accepted: pushPayload.changes.map((c) => c.documentId),
                rejected: [],
                checkpoint: 'cp-1',
              },
            } as PushAckMessage;
          }
          case 'pull':
            return {
              ...base,
              type: 'pull-response',
              payload: {
                sessionId: msg.payload.sessionId,
                changes: [],
                checkpoint: 'cp-1',
                hasMore: false,
              },
            } as PullResponseMessage;
          case 'ping':
            return { ...base, type: 'pong' } as USPMessage;
          default:
            return {
              ...base,
              type: 'error',
              payload: {
                code: 'INVALID_MESSAGE',
                message: 'Unknown message type',
                retryable: false,
              },
            } as USPMessage;
        }
      },
    };
  }

  it('should list all conformance tests', () => {
    const suite = createConformanceSuite(createMockAdapter());
    const tests = suite.listTests();
    expect(tests.length).toBeGreaterThanOrEqual(5);
    expect(tests).toContain('HANDSHAKE: accepts valid handshake');
  });

  it('should pass all tests against a conformant mock', async () => {
    const suite = createConformanceSuite(createMockAdapter());
    const report = await suite.runAll();
    expect(report.compliant).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.total).toBeGreaterThan(0);
  });

  it('should run a single test', async () => {
    const suite = createConformanceSuite(createMockAdapter());
    const result = await suite.runTest('PING: responds with pong');
    expect(result.passed).toBe(true);
  });

  it('should report failure for non-conformant server', async () => {
    const brokenAdapter: ServerAdapter = {
      async send(): Promise<USPMessage> {
        return {
          protocol: 'usp',
          version: '1.0.0',
          type: 'error',
          id: 'err',
          timestamp: Date.now(),
          payload: { code: 'INTERNAL_ERROR', message: 'Not implemented', retryable: false },
        } as USPMessage;
      },
    };

    const suite = createConformanceSuite(brokenAdapter);
    const report = await suite.runAll();
    expect(report.compliant).toBe(false);
    expect(report.failed).toBeGreaterThan(0);
  });
});
