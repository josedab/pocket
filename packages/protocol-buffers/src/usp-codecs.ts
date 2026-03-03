/**
 * Pre-built codecs for all USP message types and a codec registry
 * for dynamic message encoding/decoding and benchmarking.
 */

import type {
  MessageCodec,
  ProtocolConfig,
  BenchmarkResult,
  USPProtoMessageType,
} from './types.js';
import { BinaryCodec, createBinaryCodec } from './codec.js';
import { findMessageDescriptor } from './schema.js';

// ─── USP Message Interfaces ────────────────────────────────────

export interface USPHandshakeMessage {
  version: string;
  client_id: string;
  capabilities: string[];
  auth_token?: string;
  timestamp: number;
}

export interface USPHandshakeResponseMessage {
  accepted: boolean;
  server_id: string;
  server_capabilities: string[];
  session_id: string;
}

export interface USPDocumentMessage {
  id: string;
  rev: string;
  collection: string;
  data: Uint8Array;
  deleted: boolean;
  updated_at: number;
  vclock: Record<string, number>;
}

export interface USPRejectionMessage {
  document_id: string;
  reason: string;
  conflict?: USPDocumentMessage;
}

export interface USPPushMessage {
  session_id: string;
  changes: USPDocumentMessage[];
  checkpoint: string;
}

export interface USPPushAckMessage {
  session_id: string;
  accepted: string[];
  rejected: USPRejectionMessage[];
}

export interface USPPullMessage {
  session_id: string;
  checkpoint: string;
  collections: string[];
  limit?: number;
}

export interface USPPullResponseMessage {
  session_id: string;
  changes: USPDocumentMessage[];
  has_more: boolean;
  new_checkpoint: string;
}

export interface USPCheckpointMessage {
  session_id: string;
  checkpoint: string;
  collections: Record<string, string>;
}

export interface USPCheckpointAckMessage {
  session_id: string;
  checkpoint: string;
}

export interface USPConflictMessage {
  document_id: string;
  collection: string;
  local_doc: USPDocumentMessage;
  remote_doc: USPDocumentMessage;
  base_doc?: USPDocumentMessage;
}

export interface USPConflictResolutionMessage {
  document_id: string;
  resolved_doc: USPDocumentMessage;
  strategy: number;
}

export interface USPErrorMessage {
  code: number;
  message: string;
  details?: string;
}

export interface USPPingMessage {
  timestamp: number;
}

export interface USPPongMessage {
  timestamp: number;
  server_timestamp: number;
}

// ─── Descriptor-to-MessageType Mapping ──────────────────────────

const MESSAGE_TYPE_TO_DESCRIPTOR: Record<USPProtoMessageType, string> = {
  Handshake: 'USPHandshake',
  HandshakeResponse: 'USPHandshakeResponse',
  Push: 'USPPush',
  PushAck: 'USPPushAck',
  Pull: 'USPPull',
  PullResponse: 'USPPullResponse',
  Checkpoint: 'USPCheckpoint',
  CheckpointAck: 'USPCheckpointAck',
  Conflict: 'USPConflict',
  ConflictResolution: 'USPConflictResolution',
  Error: 'USPError',
  Ping: 'USPPing',
  Pong: 'USPPong',
};

// ─── Pre-built Codecs ───────────────────────────────────────────

function buildCodec<T extends object>(
  codec: BinaryCodec,
  descriptorName: string,
  messageType: string,
): MessageCodec<T> {
  const descriptor = findMessageDescriptor(descriptorName);
  if (!descriptor) {
    throw new Error(`Unknown message descriptor: ${descriptorName}`);
  }
  return {
    encode: (message: T) => codec.encode(message, descriptor),
    decode: (data: Uint8Array) => codec.decode<T>(data, descriptor),
    messageType,
    descriptor,
  };
}

const defaultCodec = createBinaryCodec();

/** Codec for USPHandshake messages. */
export const handshakeCodec: MessageCodec<USPHandshakeMessage> =
  buildCodec<USPHandshakeMessage>(defaultCodec, 'USPHandshake', 'Handshake');

/** Codec for USPHandshakeResponse messages. */
export const handshakeResponseCodec: MessageCodec<USPHandshakeResponseMessage> =
  buildCodec<USPHandshakeResponseMessage>(defaultCodec, 'USPHandshakeResponse', 'HandshakeResponse');

/** Codec for USPPush messages. */
export const pushCodec: MessageCodec<USPPushMessage> =
  buildCodec<USPPushMessage>(defaultCodec, 'USPPush', 'Push');

/** Codec for USPPushAck messages. */
export const pushAckCodec: MessageCodec<USPPushAckMessage> =
  buildCodec<USPPushAckMessage>(defaultCodec, 'USPPushAck', 'PushAck');

/** Codec for USPPull messages. */
export const pullCodec: MessageCodec<USPPullMessage> =
  buildCodec<USPPullMessage>(defaultCodec, 'USPPull', 'Pull');

/** Codec for USPPullResponse messages. */
export const pullResponseCodec: MessageCodec<USPPullResponseMessage> =
  buildCodec<USPPullResponseMessage>(defaultCodec, 'USPPullResponse', 'PullResponse');

/** Codec for USPCheckpoint messages. */
export const checkpointCodec: MessageCodec<USPCheckpointMessage> =
  buildCodec<USPCheckpointMessage>(defaultCodec, 'USPCheckpoint', 'Checkpoint');

/** Codec for USPCheckpointAck messages. */
export const checkpointAckCodec: MessageCodec<USPCheckpointAckMessage> =
  buildCodec<USPCheckpointAckMessage>(defaultCodec, 'USPCheckpointAck', 'CheckpointAck');

/** Codec for USPConflict messages. */
export const conflictCodec: MessageCodec<USPConflictMessage> =
  buildCodec<USPConflictMessage>(defaultCodec, 'USPConflict', 'Conflict');

/** Codec for USPConflictResolution messages. */
export const conflictResolutionCodec: MessageCodec<USPConflictResolutionMessage> =
  buildCodec<USPConflictResolutionMessage>(defaultCodec, 'USPConflictResolution', 'ConflictResolution');

/** Codec for USPError messages. */
export const errorCodec: MessageCodec<USPErrorMessage> =
  buildCodec<USPErrorMessage>(defaultCodec, 'USPError', 'Error');

/** Codec for USPPing messages. */
export const pingCodec: MessageCodec<USPPingMessage> =
  buildCodec<USPPingMessage>(defaultCodec, 'USPPing', 'Ping');

/** Codec for USPPong messages. */
export const pongCodec: MessageCodec<USPPongMessage> =
  buildCodec<USPPongMessage>(defaultCodec, 'USPPong', 'Pong');

// ─── Codec Registry ─────────────────────────────────────────────

/** Registry providing dynamic access to all USP message codecs. */
export class USPCodecRegistry {
  private readonly codecs = new Map<USPProtoMessageType, MessageCodec>();
  private readonly binaryCodec: BinaryCodec;

  constructor(config?: ProtocolConfig) {
    this.binaryCodec = createBinaryCodec(config);

    for (const [msgType, descName] of Object.entries(MESSAGE_TYPE_TO_DESCRIPTOR)) {
      const descriptor = findMessageDescriptor(descName);
      if (descriptor) {
        this.codecs.set(
          msgType as USPProtoMessageType,
          this.binaryCodec.createCodec(descriptor),
        );
      }
    }
  }

  /** Get a codec for a specific message type. */
  getCodec(messageType: USPProtoMessageType): MessageCodec {
    const codec = this.codecs.get(messageType);
    if (!codec) {
      throw new Error(`No codec registered for message type: ${messageType}`);
    }
    return codec;
  }

  /** Encode a message of the given type. */
  encode(messageType: USPProtoMessageType, message: unknown): Uint8Array {
    return this.getCodec(messageType).encode(message as Record<string, unknown>);
  }

  /** Decode binary data as the given message type. */
  decode(messageType: USPProtoMessageType, data: Uint8Array): unknown {
    return this.getCodec(messageType).decode(data);
  }

  /** Benchmark binary vs JSON encoding for sample messages. */
  benchmark(
    sampleMessages: Map<string, unknown[]>,
    iterations: number = 1000,
  ): BenchmarkResult[] {
    const results: BenchmarkResult[] = [];

    for (const [msgType, messages] of sampleMessages.entries()) {
      const codec = this.codecs.get(msgType as USPProtoMessageType);
      if (!codec || messages.length === 0) continue;

      // Binary benchmark
      const binaryStart = performance.now();
      const encoded: Uint8Array[] = [];
      for (let i = 0; i < iterations; i++) {
        for (const msg of messages) {
          encoded.push(codec.encode(msg as Record<string, unknown>));
        }
      }
      const binaryEncodeTime = performance.now() - binaryStart;

      const binaryDecodeStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        for (const enc of encoded.slice(0, messages.length)) {
          codec.decode(enc);
        }
      }
      const binaryDecodeTime = performance.now() - binaryDecodeStart;

      const totalBinarySize = encoded.slice(0, messages.length).reduce((s, e) => s + e.length, 0);
      const totalMessages = messages.length * iterations;
      const binaryThroughput = (totalBinarySize * iterations) / (1024 * 1024) / ((binaryEncodeTime + binaryDecodeTime) / 1000);

      results.push({
        format: 'binary',
        encodeTimeMs: binaryEncodeTime,
        decodeTimeMs: binaryDecodeTime,
        payloadSize: totalBinarySize,
        messageCount: totalMessages,
        throughputMBps: binaryThroughput,
      });

      // JSON benchmark
      const jsonStart = performance.now();
      const jsonEncoded: string[] = [];
      for (let i = 0; i < iterations; i++) {
        for (const msg of messages) {
          jsonEncoded.push(JSON.stringify(msg));
        }
      }
      const jsonEncodeTime = performance.now() - jsonStart;

      const jsonDecodeStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        for (const enc of jsonEncoded.slice(0, messages.length)) {
          JSON.parse(enc);
        }
      }
      const jsonDecodeTime = performance.now() - jsonDecodeStart;

      const totalJsonSize = jsonEncoded.slice(0, messages.length).reduce((s, e) => s + e.length, 0);
      const jsonThroughput = (totalJsonSize * iterations) / (1024 * 1024) / ((jsonEncodeTime + jsonDecodeTime) / 1000);

      results.push({
        format: 'json',
        encodeTimeMs: jsonEncodeTime,
        decodeTimeMs: jsonDecodeTime,
        payloadSize: totalJsonSize,
        messageCount: totalMessages,
        throughputMBps: jsonThroughput,
      });
    }

    return results;
  }
}

/** Create a new USP codec registry. */
export function createUSPCodecRegistry(config?: ProtocolConfig): USPCodecRegistry {
  return new USPCodecRegistry(config);
}
