/**
 * Reference implementation of the USP protocol.
 * Demonstrates how to implement a USP-compliant sync endpoint.
 */
import { Subject, type Observable } from 'rxjs';
import type {
  CheckpointPayload,
  DocumentChange,
  ErrorPayload,
  HandshakeAckPayload,
  HandshakePayload,
  ProtocolCapabilities,
  ProtocolMessage,
  PullPayload,
  PullResponsePayload,
  PushPayload,
  SyncState,
  USPErrorCode,
} from './protocol-spec.js';
import { createMessage, DEFAULT_CAPABILITIES, USP_SPEC_VERSION } from './protocol-spec.js';

export interface SyncSessionConfig {
  nodeId: string;
  capabilities?: Partial<ProtocolCapabilities>;
  onSend: (message: ProtocolMessage) => void;
  onError?: (error: Error) => void;
}

/**
 * Reference USP sync session implementation.
 */
export class USPSyncSession {
  private readonly nodeId: string;
  private readonly capabilities: ProtocolCapabilities;
  private readonly onSend: (message: ProtocolMessage) => void;
  private readonly onError?: (error: Error) => void;
  private state: SyncState = 'idle';
  private sessionId: string | null = null;
  private _remoteCapabilities: ProtocolCapabilities | null = null;
  private vectorClock: Record<string, number> = {};
  private lastCheckpoint: string | null = null;
  private readonly state$ = new Subject<SyncState>();
  private readonly changes$ = new Subject<DocumentChange[]>();

  constructor(config: SyncSessionConfig) {
    this.nodeId = config.nodeId;
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities };
    this.onSend = config.onSend;
    this.onError = config.onError;
  }

  /** Current sync state */
  getState(): SyncState {
    return this.state;
  }

  /** Observable of state changes */
  get stateChanges$(): Observable<SyncState> {
    return this.state$.asObservable();
  }

  /** Observable of received changes */
  get receivedChanges$(): Observable<DocumentChange[]> {
    return this.changes$.asObservable();
  }

  /** Negotiated remote capabilities after handshake */
  get remoteCapabilities(): ProtocolCapabilities | null {
    return this._remoteCapabilities;
  }

  /** Initiate handshake */
  connect(collections: string[]): void {
    this.setState('handshaking');

    const payload: HandshakePayload = {
      protocolVersion: USP_SPEC_VERSION,
      nodeId: this.nodeId,
      capabilities: this.capabilities,
      collections,
      lastCheckpoint: this.lastCheckpoint ?? undefined,
    };

    this.onSend(createMessage('handshake', this.nodeId, payload));
  }

  /** Handle incoming message */
  receive(message: ProtocolMessage): void {
    if (message.version !== USP_SPEC_VERSION) {
      this.sendError(
        'PROTOCOL_MISMATCH',
        `Expected version ${USP_SPEC_VERSION}, got ${message.version}`,
        false
      );
      return;
    }

    switch (message.type) {
      case 'handshake':
        this.handleHandshake(message as ProtocolMessage<HandshakePayload>);
        break;
      case 'handshake-ack':
        this.handleHandshakeAck(message as ProtocolMessage<HandshakeAckPayload>);
        break;
      case 'push':
        this.handlePush(message as ProtocolMessage<PushPayload>);
        break;
      case 'pull':
        this.handlePull(message as ProtocolMessage<PullPayload>);
        break;
      case 'pull-response':
        this.handlePullResponse(message as ProtocolMessage<PullResponsePayload>);
        break;
      case 'ack':
        // Acknowledged
        break;
      case 'error':
        this.handleError(message as ProtocolMessage<ErrorPayload>);
        break;
      case 'ping':
        this.onSend(createMessage('pong', this.nodeId, {}, message.messageId));
        break;
      case 'checkpoint':
        this.handleCheckpoint(message as ProtocolMessage<CheckpointPayload>);
        break;
      default:
        this.sendError('INTERNAL_ERROR', `Unknown message type: ${message.type}`, false);
    }
  }

  /** Push local changes */
  push(changes: DocumentChange[]): void {
    if (this.state !== 'syncing') {
      throw new Error('Cannot push: not in syncing state');
    }

    // Update local vector clock
    this.vectorClock[this.nodeId] = (this.vectorClock[this.nodeId] ?? 0) + 1;

    const payload: PushPayload = {
      sessionId: this.sessionId!,
      changes,
      vectorClock: { ...this.vectorClock },
    };

    this.onSend(createMessage('push', this.nodeId, payload));
  }

  /** Request changes from remote */
  pull(collections: string[], limit?: number): void {
    if (this.state !== 'syncing') {
      throw new Error('Cannot pull: not in syncing state');
    }

    const payload: PullPayload = {
      sessionId: this.sessionId!,
      collections,
      since: this.lastCheckpoint ?? undefined,
      vectorClock: { ...this.vectorClock },
      limit,
    };

    this.onSend(createMessage('pull', this.nodeId, payload));
  }

  /** Close the session */
  close(): void {
    this.setState('closed');
    this.state$.complete();
    this.changes$.complete();
  }

  // --- Message handlers ---

  private handleHandshake(message: ProtocolMessage<HandshakePayload>): void {
    const { payload } = message;

    // Negotiate capabilities
    const negotiated: ProtocolCapabilities = {
      deltaSync: this.capabilities.deltaSync && payload.capabilities.deltaSync,
      conflictResolution:
        this.capabilities.conflictResolution && payload.capabilities.conflictResolution,
      realtimePush: this.capabilities.realtimePush && payload.capabilities.realtimePush,
      batchOperations: this.capabilities.batchOperations && payload.capabilities.batchOperations,
      binaryData: this.capabilities.binaryData && payload.capabilities.binaryData,
      vectorClocks: this.capabilities.vectorClocks && payload.capabilities.vectorClocks,
      checkpoints: this.capabilities.checkpoints && payload.capabilities.checkpoints,
      maxPayloadSize: Math.min(
        this.capabilities.maxPayloadSize,
        payload.capabilities.maxPayloadSize
      ),
      compression: this.capabilities.compression.filter((c) =>
        payload.capabilities.compression.includes(c)
      ),
    };

    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this._remoteCapabilities = negotiated;
    this.setState('syncing');

    const ack: HandshakeAckPayload = {
      accepted: true,
      negotiatedCapabilities: negotiated,
      sessionId: this.sessionId,
      serverTime: new Date().toISOString(),
    };

    this.onSend(createMessage('handshake-ack', this.nodeId, ack, message.messageId));
  }

  private handleHandshakeAck(message: ProtocolMessage<HandshakeAckPayload>): void {
    const { payload } = message;
    if (!payload.accepted) {
      this.setState('error');
      this.onError?.(new Error(`Handshake rejected: ${payload.reason}`));
      return;
    }
    this.sessionId = payload.sessionId;
    this._remoteCapabilities = payload.negotiatedCapabilities;
    this.setState('syncing');
  }

  private handlePush(message: ProtocolMessage<PushPayload>): void {
    const { payload } = message;

    // Merge vector clock
    for (const [nodeId, counter] of Object.entries(payload.vectorClock)) {
      this.vectorClock[nodeId] = Math.max(this.vectorClock[nodeId] ?? 0, counter);
    }

    // Emit received changes
    this.changes$.next(payload.changes);

    // Acknowledge
    this.onSend(
      createMessage('ack', this.nodeId, { messageId: message.messageId }, message.messageId)
    );
  }

  private handlePull(_message: ProtocolMessage<PullPayload>): void {
    // In reference impl, respond with empty (override in actual implementation)
    const response: PullResponsePayload = {
      sessionId: this.sessionId!,
      changes: [],
      hasMore: false,
      checkpoint: this.lastCheckpoint ?? '',
      vectorClock: { ...this.vectorClock },
    };
    this.onSend(createMessage('pull-response', this.nodeId, response, _message.messageId));
  }

  private handlePullResponse(message: ProtocolMessage<PullResponsePayload>): void {
    const { payload } = message;

    // Merge vector clock
    for (const [nodeId, counter] of Object.entries(payload.vectorClock)) {
      this.vectorClock[nodeId] = Math.max(this.vectorClock[nodeId] ?? 0, counter);
    }

    if (payload.checkpoint) {
      this.lastCheckpoint = payload.checkpoint;
    }

    this.changes$.next(payload.changes);
  }

  private handleCheckpoint(message: ProtocolMessage<CheckpointPayload>): void {
    const { payload } = message;
    this.lastCheckpoint = payload.checkpoint;

    for (const [nodeId, counter] of Object.entries(payload.vectorClock)) {
      this.vectorClock[nodeId] = Math.max(this.vectorClock[nodeId] ?? 0, counter);
    }

    this.onSend(
      createMessage(
        'checkpoint-ack',
        this.nodeId,
        { checkpoint: payload.checkpoint },
        message.messageId
      )
    );
  }

  private handleError(message: ProtocolMessage<ErrorPayload>): void {
    this.setState('error');
    this.onError?.(new Error(`USP Error [${message.payload.code}]: ${message.payload.message}`));
  }

  private sendError(code: USPErrorCode, message: string, retryable: boolean): void {
    const payload: ErrorPayload = { code, message, retryable };
    this.onSend(createMessage('error', this.nodeId, payload));
  }

  private setState(state: SyncState): void {
    this.state = state;
    this.state$.next(state);
  }
}

export function createSyncSession(config: SyncSessionConfig): USPSyncSession {
  return new USPSyncSession(config);
}
