/**
 * USP Conformance Test Suite
 *
 * Standalone conformance tests that any USP implementation can run
 * to verify protocol compliance.
 */
import type { DocumentChange, ProtocolMessage } from './protocol-spec.js';
import { createMessage, USP_SPEC_VERSION } from './protocol-spec.js';

export interface ConformanceTestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

export interface ConformanceReport {
  implementation: string;
  version: string;
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  results: ConformanceTestResult[];
}

export type MessageHandler = (message: ProtocolMessage) => Promise<ProtocolMessage | null>;

/**
 * Runs USP conformance tests against a message handler.
 */
export class ConformanceSuite {
  private readonly handler: MessageHandler;
  private readonly results: ConformanceTestResult[] = [];

  constructor(handler: MessageHandler) {
    this.handler = handler;
  }

  /** Run all conformance tests */
  async runAll(implementation: string): Promise<ConformanceReport> {
    this.results.length = 0;

    await this.testHandshake();
    await this.testHandshakeVersionMismatch();
    await this.testPushAck();
    await this.testPullResponse();
    await this.testPingPong();
    await this.testCheckpoint();
    await this.testErrorHandling();

    return {
      implementation,
      version: USP_SPEC_VERSION,
      timestamp: new Date().toISOString(),
      totalTests: this.results.length,
      passed: this.results.filter((r) => r.passed).length,
      failed: this.results.filter((r) => !r.passed).length,
      results: [...this.results],
    };
  }

  private async runTest(name: string, fn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await fn();
      this.results.push({ name, passed: true, duration: Date.now() - start });
    } catch (err) {
      this.results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      });
    }
  }

  private async testHandshake(): Promise<void> {
    await this.runTest('Handshake: should accept valid handshake', async () => {
      const msg = createMessage('handshake', 'test-node', {
        protocolVersion: USP_SPEC_VERSION,
        nodeId: 'test-node',
        capabilities: {
          deltaSync: true,
          conflictResolution: true,
          realtimePush: true,
          batchOperations: true,
          binaryData: false,
          vectorClocks: true,
          checkpoints: true,
          maxPayloadSize: 5242880,
          compression: ['none'],
        },
        collections: ['users', 'posts'],
      });

      const response = await this.handler(msg);
      this.assert(response !== null, 'Expected a response');
      this.assert(
        response!.type === 'handshake-ack',
        `Expected handshake-ack, got ${response!.type}`
      );
      const ackPayload = response!.payload as Record<string, unknown>;
      this.assert(ackPayload.accepted === true, 'Handshake should be accepted');
      this.assert(typeof ackPayload.sessionId === 'string', 'Session ID should be a string');
    });
  }

  private async testHandshakeVersionMismatch(): Promise<void> {
    await this.runTest('Handshake: should reject version mismatch', async () => {
      const msg = createMessage('handshake', 'test-node', {
        protocolVersion: '99.99.99',
        nodeId: 'test-node',
        capabilities: {
          deltaSync: true,
          conflictResolution: true,
          realtimePush: false,
          batchOperations: false,
          binaryData: false,
          vectorClocks: false,
          checkpoints: false,
          maxPayloadSize: 1024,
          compression: ['none'],
        },
        collections: [],
      });
      msg.version = '99.99.99';

      const response = await this.handler(msg);
      this.assert(response !== null, 'Expected a response');
      const payload = response!.payload as Record<string, unknown>;
      // Should either reject or return error
      if (response!.type === 'error') {
        this.assert(payload.code === 'PROTOCOL_MISMATCH', 'Error code should be PROTOCOL_MISMATCH');
      } else if (response!.type === 'handshake-ack') {
        this.assert(payload.accepted === false, 'Should not accept mismatched version');
      }
    });
  }

  private async testPushAck(): Promise<void> {
    await this.runTest('Push: should acknowledge push messages', async () => {
      // First handshake
      const hsMsg = createMessage('handshake', 'test-node', {
        protocolVersion: USP_SPEC_VERSION,
        nodeId: 'test-node',
        capabilities: {
          deltaSync: true,
          conflictResolution: true,
          realtimePush: true,
          batchOperations: true,
          binaryData: false,
          vectorClocks: true,
          checkpoints: true,
          maxPayloadSize: 5242880,
          compression: ['none'],
        },
        collections: ['test'],
      });
      const hsResp = await this.handler(hsMsg);
      const sessionId =
        ((hsResp?.payload as Record<string, unknown>)?.sessionId as string) ?? 'test-session';

      const change: DocumentChange = {
        id: 'doc-1',
        collection: 'test',
        operation: 'create',
        data: { name: 'Test' },
        metadata: {
          revision: 1,
          timestamp: new Date().toISOString(),
          origin: 'test-node',
          vectorClock: { 'test-node': 1 },
        },
      };

      const pushMsg = createMessage('push', 'test-node', {
        sessionId,
        changes: [change],
        vectorClock: { 'test-node': 1 },
      });

      const response = await this.handler(pushMsg);
      this.assert(response !== null, 'Expected acknowledgement');
      this.assert(response!.type === 'ack', `Expected ack, got ${response!.type}`);
    });
  }

  private async testPullResponse(): Promise<void> {
    await this.runTest('Pull: should respond to pull requests', async () => {
      const pullMsg = createMessage('pull', 'test-node', {
        sessionId: 'test-session',
        collections: ['test'],
        vectorClock: {},
      });

      const response = await this.handler(pullMsg);
      this.assert(response !== null, 'Expected a response');
      this.assert(
        response!.type === 'pull-response',
        `Expected pull-response, got ${response!.type}`
      );
      const pullPayload = response!.payload as Record<string, unknown>;
      this.assert(Array.isArray(pullPayload.changes), 'Changes should be an array');
      this.assert(typeof pullPayload.hasMore === 'boolean', 'hasMore should be boolean');
    });
  }

  private async testPingPong(): Promise<void> {
    await this.runTest('Ping: should respond with pong', async () => {
      const pingMsg = createMessage('ping', 'test-node', {});
      const response = await this.handler(pingMsg);
      this.assert(response !== null, 'Expected pong response');
      this.assert(response!.type === 'pong', `Expected pong, got ${response!.type}`);
    });
  }

  private async testCheckpoint(): Promise<void> {
    await this.runTest('Checkpoint: should acknowledge checkpoints', async () => {
      const cpMsg = createMessage('checkpoint', 'test-node', {
        sessionId: 'test-session',
        checkpoint: 'cp-1',
        vectorClock: { 'test-node': 5 },
        collections: ['test'],
      });

      const response = await this.handler(cpMsg);
      this.assert(response !== null, 'Expected checkpoint-ack');
      this.assert(
        response!.type === 'checkpoint-ack',
        `Expected checkpoint-ack, got ${response!.type}`
      );
    });
  }

  private async testErrorHandling(): Promise<void> {
    await this.runTest('Error: should handle malformed messages gracefully', async () => {
      const badMsg = createMessage('push', 'test-node', { invalid: true });
      // Should not throw, should return error or handle gracefully
      try {
        const response = await this.handler(badMsg);
        // Either returns error or null, both are acceptable
        if (response?.type === 'error') {
          const errPayload = response.payload as Record<string, unknown>;
          this.assert(typeof errPayload.code === 'string', 'Error should have a code');
        }
      } catch {
        // Throwing is acceptable but not preferred
      }
    });
  }

  private assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`Assertion failed: ${message}`);
  }
}

export function createConformanceSuite(handler: MessageHandler): ConformanceSuite {
  return new ConformanceSuite(handler);
}
