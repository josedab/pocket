/**
 * @pocket/protocol-buffers
 *
 * Protocol Buffer binary serialization for Pocket's Universal Sync Protocol (USP).
 */

// Types
export type {
  WireType,
  ProtoFieldDescriptor,
  ProtoScalarType,
  ProtoType,
  ProtoMessageDescriptor,
  ProtoEnumDescriptor,
  ProtoFileDescriptor,
  ProtoServiceDescriptor,
  ProtoMethodDescriptor,
  SerializationResult,
  DeserializationResult,
  MessageCodec,
  ProtocolConfig,
  BenchmarkResult,
  USPProtoMessageType,
} from './types.js';

// Schema
export {
  USP_PROTO_SCHEMA,
  generateProtoFile,
  findMessageDescriptor,
  isScalarType,
} from './schema.js';

// Codec
export {
  BinaryCodec,
  createBinaryCodec,
  encodeVarint,
  decodeVarint,
  zigzagEncode,
  zigzagDecode,
} from './codec.js';

// USP Codecs
export type {
  USPHandshakeMessage,
  USPHandshakeResponseMessage,
  USPDocumentMessage,
  USPRejectionMessage,
  USPPushMessage,
  USPPushAckMessage,
  USPPullMessage,
  USPPullResponseMessage,
  USPCheckpointMessage,
  USPCheckpointAckMessage,
  USPConflictMessage,
  USPConflictResolutionMessage,
  USPErrorMessage,
  USPPingMessage,
  USPPongMessage,
} from './usp-codecs.js';

export {
  handshakeCodec,
  handshakeResponseCodec,
  pushCodec,
  pushAckCodec,
  pullCodec,
  pullResponseCodec,
  checkpointCodec,
  checkpointAckCodec,
  conflictCodec,
  conflictResolutionCodec,
  errorCodec,
  pingCodec,
  pongCodec,
  USPCodecRegistry,
  createUSPCodecRegistry,
} from './usp-codecs.js';
