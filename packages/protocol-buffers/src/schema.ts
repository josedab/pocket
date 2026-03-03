/**
 * USP Protocol Buffer schema definitions.
 *
 * Defines the complete USP message schema as TypeScript descriptors
 * (no .proto files needed) and provides a generator for .proto text output.
 */

import type {
  ProtoFileDescriptor,
  ProtoMessageDescriptor,
  ProtoEnumDescriptor,
  ProtoFieldDescriptor,
} from './types.js';

// ─── Enum Descriptors ───────────────────────────────────────────

const conflictStrategyEnum: ProtoEnumDescriptor = {
  name: 'ConflictStrategy',
  values: [
    { name: 'CONFLICT_STRATEGY_UNSPECIFIED', number: 0 },
    { name: 'SERVER_WINS', number: 1 },
    { name: 'CLIENT_WINS', number: 2 },
    { name: 'LAST_WRITE_WINS', number: 3 },
    { name: 'MERGE', number: 4 },
    { name: 'CUSTOM', number: 5 },
  ],
};

const errorCodeEnum: ProtoEnumDescriptor = {
  name: 'ErrorCode',
  values: [
    { name: 'ERROR_CODE_UNSPECIFIED', number: 0 },
    { name: 'AUTH_FAILED', number: 1 },
    { name: 'SESSION_EXPIRED', number: 2 },
    { name: 'COLLECTION_NOT_FOUND', number: 3 },
    { name: 'CONFLICT', number: 4 },
    { name: 'QUOTA_EXCEEDED', number: 5 },
    { name: 'RATE_LIMITED', number: 6 },
    { name: 'INVALID_MESSAGE', number: 7 },
    { name: 'INTERNAL_ERROR', number: 8 },
    { name: 'VERSION_MISMATCH', number: 9 },
  ],
};

// ─── Message Descriptors ────────────────────────────────────────

const handshakeMessage: ProtoMessageDescriptor = {
  name: 'USPHandshake',
  fields: [
    { name: 'version', fieldNumber: 1, type: 'string' },
    { name: 'client_id', fieldNumber: 2, type: 'string' },
    { name: 'capabilities', fieldNumber: 3, type: 'string', repeated: true },
    { name: 'auth_token', fieldNumber: 4, type: 'string', optional: true },
    { name: 'timestamp', fieldNumber: 5, type: 'int64' },
  ],
};

const handshakeResponseMessage: ProtoMessageDescriptor = {
  name: 'USPHandshakeResponse',
  fields: [
    { name: 'accepted', fieldNumber: 1, type: 'bool' },
    { name: 'server_id', fieldNumber: 2, type: 'string' },
    { name: 'server_capabilities', fieldNumber: 3, type: 'string', repeated: true },
    { name: 'session_id', fieldNumber: 4, type: 'string' },
  ],
};

const documentMessage: ProtoMessageDescriptor = {
  name: 'USPDocument',
  fields: [
    { name: 'id', fieldNumber: 1, type: 'string' },
    { name: 'rev', fieldNumber: 2, type: 'string' },
    { name: 'collection', fieldNumber: 3, type: 'string' },
    { name: 'data', fieldNumber: 4, type: 'bytes' },
    { name: 'deleted', fieldNumber: 5, type: 'bool' },
    { name: 'updated_at', fieldNumber: 6, type: 'int64' },
    { name: 'vclock', fieldNumber: 7, type: 'string', mapKeyType: 'string', mapValueType: 'int64' },
  ],
};

const rejectionMessage: ProtoMessageDescriptor = {
  name: 'USPRejection',
  fields: [
    { name: 'document_id', fieldNumber: 1, type: 'string' },
    { name: 'reason', fieldNumber: 2, type: 'string' },
    { name: 'conflict', fieldNumber: 3, type: 'USPDocument', optional: true },
  ],
};

const pushMessage: ProtoMessageDescriptor = {
  name: 'USPPush',
  fields: [
    { name: 'session_id', fieldNumber: 1, type: 'string' },
    { name: 'changes', fieldNumber: 2, type: 'USPDocument', repeated: true },
    { name: 'checkpoint', fieldNumber: 3, type: 'string' },
  ],
};

const pushAckMessage: ProtoMessageDescriptor = {
  name: 'USPPushAck',
  fields: [
    { name: 'session_id', fieldNumber: 1, type: 'string' },
    { name: 'accepted', fieldNumber: 2, type: 'string', repeated: true },
    { name: 'rejected', fieldNumber: 3, type: 'USPRejection', repeated: true },
  ],
};

const pullMessage: ProtoMessageDescriptor = {
  name: 'USPPull',
  fields: [
    { name: 'session_id', fieldNumber: 1, type: 'string' },
    { name: 'checkpoint', fieldNumber: 2, type: 'string' },
    { name: 'collections', fieldNumber: 3, type: 'string', repeated: true },
    { name: 'limit', fieldNumber: 4, type: 'int32', optional: true },
  ],
};

const pullResponseMessage: ProtoMessageDescriptor = {
  name: 'USPPullResponse',
  fields: [
    { name: 'session_id', fieldNumber: 1, type: 'string' },
    { name: 'changes', fieldNumber: 2, type: 'USPDocument', repeated: true },
    { name: 'has_more', fieldNumber: 3, type: 'bool' },
    { name: 'new_checkpoint', fieldNumber: 4, type: 'string' },
  ],
};

const checkpointMessage: ProtoMessageDescriptor = {
  name: 'USPCheckpoint',
  fields: [
    { name: 'session_id', fieldNumber: 1, type: 'string' },
    { name: 'checkpoint', fieldNumber: 2, type: 'string' },
    { name: 'collections', fieldNumber: 3, type: 'string', mapKeyType: 'string', mapValueType: 'string' },
  ],
};

const checkpointAckMessage: ProtoMessageDescriptor = {
  name: 'USPCheckpointAck',
  fields: [
    { name: 'session_id', fieldNumber: 1, type: 'string' },
    { name: 'checkpoint', fieldNumber: 2, type: 'string' },
  ],
};

const conflictMessage: ProtoMessageDescriptor = {
  name: 'USPConflict',
  fields: [
    { name: 'document_id', fieldNumber: 1, type: 'string' },
    { name: 'collection', fieldNumber: 2, type: 'string' },
    { name: 'local_doc', fieldNumber: 3, type: 'USPDocument' },
    { name: 'remote_doc', fieldNumber: 4, type: 'USPDocument' },
    { name: 'base_doc', fieldNumber: 5, type: 'USPDocument', optional: true },
  ],
};

const conflictResolutionMessage: ProtoMessageDescriptor = {
  name: 'USPConflictResolution',
  fields: [
    { name: 'document_id', fieldNumber: 1, type: 'string' },
    { name: 'resolved_doc', fieldNumber: 2, type: 'USPDocument' },
    { name: 'strategy', fieldNumber: 3, type: 'ConflictStrategy' },
  ],
  enums: [conflictStrategyEnum],
};

const errorMessage: ProtoMessageDescriptor = {
  name: 'USPError',
  fields: [
    { name: 'code', fieldNumber: 1, type: 'ErrorCode' },
    { name: 'message', fieldNumber: 2, type: 'string' },
    { name: 'details', fieldNumber: 3, type: 'string', optional: true },
  ],
  enums: [errorCodeEnum],
};

const pingMessage: ProtoMessageDescriptor = {
  name: 'USPPing',
  fields: [
    { name: 'timestamp', fieldNumber: 1, type: 'int64' },
  ],
};

const pongMessage: ProtoMessageDescriptor = {
  name: 'USPPong',
  fields: [
    { name: 'timestamp', fieldNumber: 1, type: 'int64' },
    { name: 'server_timestamp', fieldNumber: 2, type: 'int64' },
  ],
};

// ─── Full Schema ────────────────────────────────────────────────

/** Complete USP Protocol Buffer file descriptor. */
export const USP_PROTO_SCHEMA: ProtoFileDescriptor = {
  syntax: 'proto3',
  package: 'pocket.usp.v1',
  messages: [
    handshakeMessage,
    handshakeResponseMessage,
    documentMessage,
    rejectionMessage,
    pushMessage,
    pushAckMessage,
    pullMessage,
    pullResponseMessage,
    checkpointMessage,
    checkpointAckMessage,
    conflictMessage,
    conflictResolutionMessage,
    errorMessage,
    pingMessage,
    pongMessage,
  ],
  enums: [conflictStrategyEnum, errorCodeEnum],
  services: [
    {
      name: 'USPSyncService',
      methods: [
        { name: 'Handshake', inputType: 'USPHandshake', outputType: 'USPHandshakeResponse' },
        { name: 'Push', inputType: 'USPPush', outputType: 'USPPushAck' },
        { name: 'Pull', inputType: 'USPPull', outputType: 'USPPullResponse' },
        { name: 'Checkpoint', inputType: 'USPCheckpoint', outputType: 'USPCheckpointAck' },
        { name: 'SyncStream', inputType: 'USPPush', outputType: 'USPPullResponse', clientStreaming: true, serverStreaming: true },
      ],
    },
  ],
};

// ─── Proto File Generator ───────────────────────────────────────

const SCALAR_TYPES = new Set<string>([
  'double', 'float', 'int32', 'int64', 'uint32', 'uint64',
  'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64',
  'bool', 'string', 'bytes',
]);

function formatFieldLine(field: ProtoFieldDescriptor): string {
  if (field.mapKeyType && field.mapValueType) {
    return `  map<${field.mapKeyType}, ${field.mapValueType}> ${field.name} = ${field.fieldNumber};`;
  }
  const prefix = field.repeated ? 'repeated ' : field.optional ? 'optional ' : '';
  return `  ${prefix}${field.type} ${field.name} = ${field.fieldNumber};`;
}

function formatEnum(desc: ProtoEnumDescriptor, indent: string): string {
  const lines = [`${indent}enum ${desc.name} {`];
  for (const v of desc.values) {
    lines.push(`${indent}  ${v.name} = ${v.number};`);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function formatMessage(desc: ProtoMessageDescriptor, indent: string): string {
  const lines = [`${indent}message ${desc.name} {`];
  if (desc.enums) {
    for (const e of desc.enums) {
      lines.push(formatEnum(e, indent + '  '));
      lines.push('');
    }
  }
  if (desc.nestedMessages) {
    for (const m of desc.nestedMessages) {
      lines.push(formatMessage(m, indent + '  '));
      lines.push('');
    }
  }
  for (const f of desc.fields) {
    lines.push(`${indent}${formatFieldLine(f)}`);
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

/** Generate a .proto file text from a file descriptor. */
export function generateProtoFile(schema: ProtoFileDescriptor): string {
  const lines: string[] = [];

  lines.push(`syntax = "${schema.syntax}";`);
  lines.push('');
  lines.push(`package ${schema.package};`);
  lines.push('');

  if (schema.imports?.length) {
    for (const imp of schema.imports) {
      lines.push(`import "${imp}";`);
    }
    lines.push('');
  }

  // Top-level enums
  if (schema.enums?.length) {
    for (const e of schema.enums) {
      lines.push(formatEnum(e, ''));
      lines.push('');
    }
  }

  // Messages
  for (const m of schema.messages) {
    lines.push(formatMessage(m, ''));
    lines.push('');
  }

  // Services
  if (schema.services?.length) {
    for (const svc of schema.services) {
      lines.push(`service ${svc.name} {`);
      for (const method of svc.methods) {
        const clientStream = method.clientStreaming ? 'stream ' : '';
        const serverStream = method.serverStreaming ? 'stream ' : '';
        lines.push(`  rpc ${method.name} (${clientStream}${method.inputType}) returns (${serverStream}${method.outputType});`);
      }
      lines.push('}');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Look up a message descriptor by name from the schema. */
export function findMessageDescriptor(
  name: string,
  schema: ProtoFileDescriptor = USP_PROTO_SCHEMA,
): ProtoMessageDescriptor | undefined {
  for (const msg of schema.messages) {
    if (msg.name === name) return msg;
    if (msg.nestedMessages) {
      for (const nested of msg.nestedMessages) {
        if (nested.name === name) return nested;
      }
    }
  }
  return undefined;
}

/** Check if a type string refers to a scalar type. */
export function isScalarType(type: string): boolean {
  return SCALAR_TYPES.has(type);
}
