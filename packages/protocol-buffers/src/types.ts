/**
 * Protocol Buffer type definitions for Pocket's Universal Sync Protocol.
 *
 * Defines descriptors, codecs, and serialization result types used
 * throughout the protobuf encoding/decoding pipeline.
 */

// ─── Wire Types ──────────────────────────────────────────────────

/** Protobuf wire types */
export type WireType = 0 | 1 | 2 | 5; // varint, 64-bit, length-delimited, 32-bit

// ─── Proto Descriptors ──────────────────────────────────────────

/** Field descriptor for proto schema */
export interface ProtoFieldDescriptor {
  name: string;
  fieldNumber: number;
  type: ProtoType;
  repeated?: boolean;
  optional?: boolean;
  mapKeyType?: ProtoScalarType;
  mapValueType?: ProtoType;
  oneofGroup?: string;
}

export type ProtoScalarType =
  | 'double' | 'float' | 'int32' | 'int64' | 'uint32' | 'uint64'
  | 'sint32' | 'sint64' | 'fixed32' | 'fixed64' | 'sfixed32' | 'sfixed64'
  | 'bool' | 'string' | 'bytes';

export type ProtoType = ProtoScalarType | string; // string for message type refs

/** Proto message descriptor */
export interface ProtoMessageDescriptor {
  name: string;
  fields: ProtoFieldDescriptor[];
  nestedMessages?: ProtoMessageDescriptor[];
  enums?: ProtoEnumDescriptor[];
}

export interface ProtoEnumDescriptor {
  name: string;
  values: Array<{ name: string; number: number }>;
}

/** Proto file descriptor */
export interface ProtoFileDescriptor {
  syntax: 'proto3';
  package: string;
  imports?: string[];
  messages: ProtoMessageDescriptor[];
  enums?: ProtoEnumDescriptor[];
  services?: ProtoServiceDescriptor[];
}

export interface ProtoServiceDescriptor {
  name: string;
  methods: ProtoMethodDescriptor[];
}

export interface ProtoMethodDescriptor {
  name: string;
  inputType: string;
  outputType: string;
  clientStreaming?: boolean;
  serverStreaming?: boolean;
}

// ─── Serialization Results ──────────────────────────────────────

/** Serialization result */
export interface SerializationResult {
  data: Uint8Array;
  size: number;
  messageType: string;
}

/** Deserialization result */
export interface DeserializationResult<T = Record<string, unknown>> {
  message: T;
  messageType: string;
  bytesRead: number;
}

// ─── Codec ──────────────────────────────────────────────────────

/** Codec for a specific message type */
export interface MessageCodec<T = Record<string, unknown>> {
  encode(message: T): Uint8Array;
  decode(data: Uint8Array): T;
  messageType: string;
  descriptor: ProtoMessageDescriptor;
}

/** Protocol configuration */
export interface ProtocolConfig {
  preferBinary?: boolean;
  compressionEnabled?: boolean;
  maxMessageSize?: number;
  validateOnDecode?: boolean;
}

// ─── Benchmarks ─────────────────────────────────────────────────

/** Benchmark result */
export interface BenchmarkResult {
  format: 'json' | 'binary';
  encodeTimeMs: number;
  decodeTimeMs: number;
  payloadSize: number;
  messageCount: number;
  throughputMBps: number;
}

// ─── USP Proto Message Types ────────────────────────────────────

/** USP Protobuf message types */
export type USPProtoMessageType =
  | 'Handshake' | 'HandshakeResponse'
  | 'Push' | 'PushAck'
  | 'Pull' | 'PullResponse'
  | 'Checkpoint' | 'CheckpointAck'
  | 'Conflict' | 'ConflictResolution'
  | 'Error' | 'Ping' | 'Pong';
