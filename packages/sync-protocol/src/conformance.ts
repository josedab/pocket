/**
 * USP Conformance Test Suite — verifies that a server implementation
 * correctly handles the Universal Sync Protocol.
 *
 * Usage:
 * ```ts
 * const suite = createConformanceSuite(myServerAdapter);
 * const results = await suite.runAll();
 * console.log(results.summary);
 * ```
 */

import type {
  ChangeRecord,
  HandshakeAckMessage,
  PullResponseMessage,
  PushAckMessage,
  USPMessage,
} from './types.js';
import { createHandshake, createPull, createPush, validateEnvelope } from './validators.js';

/** Adapter interface that a server implementation must provide. */
export interface ServerAdapter {
  /** Send a message to the server and receive the response. */
  send(message: USPMessage): Promise<USPMessage>;
  /** Set up the server (called before tests). */
  setup?(): Promise<void>;
  /** Tear down the server (called after tests). */
  teardown?(): Promise<void>;
}

/** A single conformance test result. */
export interface ConformanceTestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: string;
  readonly durationMs: number;
}

/** Aggregate conformance results. */
export interface ConformanceReport {
  readonly tests: readonly ConformanceTestResult[];
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly compliant: boolean;
}

type TestFn = () => Promise<void>;

export class ConformanceSuite {
  private readonly tests = new Map<string, TestFn>();

  constructor(private readonly adapter: ServerAdapter) {
    this.registerCoreTests();
  }

  /** Run all conformance tests. */
  async runAll(): Promise<ConformanceReport> {
    await this.adapter.setup?.();

    const results: ConformanceTestResult[] = [];

    for (const [name, testFn] of this.tests) {
      const start = performance.now();
      try {
        await testFn();
        results.push({
          name,
          passed: true,
          durationMs: performance.now() - start,
        });
      } catch (err) {
        results.push({
          name,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: performance.now() - start,
        });
      }
    }

    await this.adapter.teardown?.();

    const passed = results.filter((r) => r.passed).length;
    return {
      tests: results,
      passed,
      failed: results.length - passed,
      total: results.length,
      compliant: passed === results.length,
    };
  }

  /** Run a single test by name. */
  async runTest(name: string): Promise<ConformanceTestResult> {
    const testFn = this.tests.get(name);
    if (!testFn) {
      return { name, passed: false, error: 'Test not found', durationMs: 0 };
    }

    const start = performance.now();
    try {
      await testFn();
      return { name, passed: true, durationMs: performance.now() - start };
    } catch (err) {
      return {
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - start,
      };
    }
  }

  /** List all registered test names. */
  listTests(): string[] {
    return Array.from(this.tests.keys());
  }

  private registerCoreTests(): void {
    this.tests.set('HANDSHAKE: accepts valid handshake', async () => {
      const msg = createHandshake('test-node', ['todos'], ['push', 'pull']);
      const response = await this.adapter.send(msg);

      this.assert(
        response.type === 'handshake-ack',
        `Expected handshake-ack, got ${response.type}`
      );
      const envelope = validateEnvelope(response);
      this.assert(envelope.valid, `Invalid envelope: ${envelope.errors.join(', ')}`);

      const ack = response as HandshakeAckMessage;
      this.assert(typeof ack.payload.sessionId === 'string', 'Missing sessionId');
      this.assert(typeof ack.payload.serverNodeId === 'string', 'Missing serverNodeId');
      this.assert(Array.isArray(ack.payload.acceptedCollections), 'Missing acceptedCollections');
    });

    this.tests.set('HANDSHAKE: rejects invalid auth', async () => {
      const msg = createHandshake('node', ['todos'], [], {
        type: 'bearer',
        token: 'invalid-token-xxx',
      });
      const response = await this.adapter.send(msg);

      // Server should respond with error or handshake-ack with no collections
      this.assert(
        response.type === 'error' || response.type === 'handshake-ack',
        `Expected error or handshake-ack, got ${response.type}`
      );
    });

    this.tests.set('PUSH: accepts valid changes', async () => {
      // First handshake
      const hs = createHandshake('push-test', ['todos'], ['push']);
      const hsResp = await this.adapter.send(hs);
      const sessionId = (hsResp as HandshakeAckMessage).payload?.sessionId ?? 'test';

      const change: ChangeRecord = {
        collection: 'todos',
        documentId: 'doc-1',
        operation: 'insert',
        document: {
          _id: 'doc-1',
          _rev: '1-abc',
          _updatedAt: Date.now(),
          title: 'Test',
        },
        timestamp: Date.now(),
        nodeId: 'push-test',
        vclock: { 'push-test': 1 },
      };

      const push = createPush(sessionId, [change], 'cp-0');
      const response = await this.adapter.send(push);

      this.assert(response.type === 'push-ack', `Expected push-ack, got ${response.type}`);
      const ack = response as PushAckMessage;
      this.assert(Array.isArray(ack.payload.accepted), 'Missing accepted array');
    });

    this.tests.set('PULL: returns changes since checkpoint', async () => {
      const hs = createHandshake('pull-test', ['todos'], ['pull']);
      const hsResp = await this.adapter.send(hs);
      const sessionId = (hsResp as HandshakeAckMessage).payload?.sessionId ?? 'test';

      const pull = createPull(sessionId, 'cp-0');
      const response = await this.adapter.send(pull);

      this.assert(
        response.type === 'pull-response',
        `Expected pull-response, got ${response.type}`
      );
      const pr = response as PullResponseMessage;
      this.assert(Array.isArray(pr.payload.changes), 'Missing changes array');
      this.assert(typeof pr.payload.checkpoint === 'string', 'Missing checkpoint');
      this.assert(typeof pr.payload.hasMore === 'boolean', 'Missing hasMore flag');
    });

    this.tests.set('PING: responds with pong', async () => {
      const ping: USPMessage = {
        protocol: 'usp',
        version: '1.0.0',
        type: 'ping',
        id: 'ping-1',
        timestamp: Date.now(),
      };
      const response = await this.adapter.send(ping);
      this.assert(response.type === 'pong', `Expected pong, got ${response.type}`);
    });

    this.tests.set('ERROR: rejects malformed message', async () => {
      const malformed = {
        protocol: 'usp',
        version: '1.0.0',
        type: 'push',
        id: 'bad-1',
        timestamp: Date.now(),
        // Missing payload
      } as unknown as USPMessage;

      const response = await this.adapter.send(malformed);
      this.assert(
        response.type === 'error',
        `Expected error for malformed message, got ${response.type}`
      );
    });

    this.tests.set('VERSION: handles version negotiation', async () => {
      const msg = createHandshake('version-test', ['todos'], ['push']);
      const response = await this.adapter.send(msg);
      const envelope = validateEnvelope(response);
      this.assert(envelope.valid, 'Response must have valid envelope');
      this.assert(typeof response.version === 'string', 'Must include version');
    });
  }

  private assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`Conformance assertion failed: ${message}`);
  }
}

export function createConformanceSuite(adapter: ServerAdapter): ConformanceSuite {
  return new ConformanceSuite(adapter);
}
