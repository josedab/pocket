export type {
  Capability,
  ChangeRecord,
  Checkpoint,
  CollectionName,
  ConflictResolution,
  ConflictStrategy,
  DocumentId,
  DocumentMeta,
  ErrorCode,
  ErrorMessage,
  HandshakeAckMessage,
  HandshakeMessage,
  MessageEnvelope,
  MessageType,
  NodeId,
  PingMessage,
  PongMessage,
  PullMessage,
  PullResponseMessage,
  PushAckMessage,
  PushMessage,
  USPMessage,
  VectorClock,
} from './types.js';

export { CAPABILITIES, USP_PROTOCOL_ID, USP_VERSION } from './types.js';

export {
  createHandshake,
  createPull,
  createPush,
  validateChangeRecord,
  validateEnvelope,
  validateHandshake,
  validateMessage,
  validatePull,
  validatePush,
  type ValidationResult,
} from './validators.js';

export {
  ConformanceSuite,
  createConformanceSuite,
  type ConformanceReport,
  type ConformanceTestResult,
  type ServerAdapter,
} from './conformance.js';

// Protocol Specification
export { DEFAULT_CAPABILITIES, USP_SPEC_VERSION, createMessage } from './protocol-spec.js';
export type {
  CheckpointPayload,
  DocumentChange,
  ErrorPayload,
  HandshakeAckPayload,
  HandshakePayload,
  ProtocolCapabilities,
  ProtocolMessage,
  MessageType as ProtocolMessageType,
  PullPayload,
  PullResponsePayload,
  PushPayload,
  SyncState,
  USPErrorCode,
} from './protocol-spec.js';

// Reference Implementation
export { USPSyncSession, createSyncSession } from './reference-impl.js';
export type { SyncSessionConfig } from './reference-impl.js';

// Conformance Suite (USP Spec)
export {
  ConformanceSuite as USPConformanceSuite,
  createConformanceSuite as createUSPConformanceSuite,
} from './conformance-suite.js';
export type {
  MessageHandler,
  ConformanceReport as USPConformanceReport,
  ConformanceTestResult as USPConformanceTestResult,
} from './conformance-suite.js';
