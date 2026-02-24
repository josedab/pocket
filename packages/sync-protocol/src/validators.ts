/**
 * USP Message Validators — runtime validation for protocol messages.
 *
 * Ensures that incoming/outgoing messages conform to the USP spec,
 * catching malformed data before it causes sync errors.
 */

import type {
  ChangeRecord,
  HandshakeMessage,
  MessageEnvelope,
  PullMessage,
  PushMessage,
} from './types.js';
import { USP_PROTOCOL_ID, USP_VERSION } from './types.js';

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(...errors: string[]): ValidationResult {
  return { valid: false, errors };
}

/** Validate a base message envelope. */
export function validateEnvelope(msg: unknown): ValidationResult {
  if (typeof msg !== 'object' || msg === null) {
    return fail('Message must be an object');
  }

  const m = msg as Record<string, unknown>;
  const errors: string[] = [];

  if (m.protocol !== USP_PROTOCOL_ID) {
    errors.push(`Invalid protocol: expected "${USP_PROTOCOL_ID}", got "${String(m.protocol)}"`);
  }
  if (typeof m.version !== 'string') {
    errors.push('Missing or invalid "version" field');
  }
  if (typeof m.type !== 'string') {
    errors.push('Missing or invalid "type" field');
  }
  if (typeof m.id !== 'string' || m.id.length === 0) {
    errors.push('Missing or empty "id" field');
  }
  if (typeof m.timestamp !== 'number') {
    errors.push('Missing or invalid "timestamp" field');
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

/** Validate a handshake message. */
export function validateHandshake(msg: HandshakeMessage): ValidationResult {
  const envelope = validateEnvelope(msg);
  if (!envelope.valid) return envelope;

  const errors: string[] = [];
  const p = msg.payload;

  if (!p || typeof p !== 'object') {
    return fail('Missing payload');
  }
  if (typeof p.nodeId !== 'string' || p.nodeId.length === 0) {
    errors.push('payload.nodeId must be a non-empty string');
  }
  if (!Array.isArray(p.collections) || p.collections.length === 0) {
    errors.push('payload.collections must be a non-empty array');
  }
  if (!Array.isArray(p.capabilities)) {
    errors.push('payload.capabilities must be an array');
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

/** Validate a change record. */
export function validateChangeRecord(record: unknown): ValidationResult {
  if (typeof record !== 'object' || record === null) {
    return fail('Change record must be an object');
  }

  const r = record as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof r.collection !== 'string') errors.push('Missing collection');
  if (typeof r.documentId !== 'string') errors.push('Missing documentId');
  if (!['insert', 'update', 'delete'].includes(r.operation as string)) {
    errors.push('Invalid operation');
  }
  if (typeof r.timestamp !== 'number') errors.push('Missing timestamp');
  if (typeof r.nodeId !== 'string') errors.push('Missing nodeId');
  if (typeof r.vclock !== 'object' || r.vclock === null) {
    errors.push('Missing or invalid vclock');
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

/** Validate a push message. */
export function validatePush(msg: PushMessage): ValidationResult {
  const envelope = validateEnvelope(msg);
  if (!envelope.valid) return envelope;

  const errors: string[] = [];
  const p = msg.payload;

  if (!p) return fail('Missing payload');
  if (typeof p.sessionId !== 'string') errors.push('Missing sessionId');
  if (!Array.isArray(p.changes)) errors.push('changes must be an array');

  if (Array.isArray(p.changes)) {
    for (let i = 0; i < p.changes.length; i++) {
      const cr = validateChangeRecord(p.changes[i]);
      if (!cr.valid) {
        errors.push(`changes[${i}]: ${cr.errors.join(', ')}`);
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : ok();
}

/** Validate a pull message. */
export function validatePull(msg: PullMessage): ValidationResult {
  const envelope = validateEnvelope(msg);
  if (!envelope.valid) return envelope;

  const p = msg.payload;
  if (!p) return fail('Missing payload');
  if (typeof p.sessionId !== 'string') return fail('Missing sessionId');
  if (typeof p.checkpoint !== 'string') return fail('Missing checkpoint');

  return ok();
}

/** Validate any USP message based on its type. */
export function validateMessage(msg: unknown): ValidationResult {
  const envelope = validateEnvelope(msg);
  if (!envelope.valid) return envelope;

  const m = msg as MessageEnvelope;
  switch (m.type) {
    case 'handshake':
      return validateHandshake(msg as HandshakeMessage);
    case 'push':
      return validatePush(msg as PushMessage);
    case 'pull':
      return validatePull(msg as PullMessage);
    default:
      return envelope;
  }
}

// ─── Message Factory Helpers ─────────────────────────────────────

let messageCounter = 0;

function createEnvelope(type: string): MessageEnvelope {
  return {
    protocol: USP_PROTOCOL_ID,
    version: USP_VERSION,
    type: type as MessageEnvelope['type'],
    id: `usp-${++messageCounter}-${Date.now()}`,
    timestamp: Date.now(),
  };
}

/** Create a handshake message. */
export function createHandshake(
  nodeId: string,
  collections: string[],
  capabilities: string[] = ['push', 'pull'],
  auth?: { type: 'bearer' | 'api-key'; token: string }
): HandshakeMessage {
  return {
    ...createEnvelope('handshake'),
    type: 'handshake',
    payload: { nodeId, collections, capabilities, auth },
  };
}

/** Create a push message. */
export function createPush(
  sessionId: string,
  changes: ChangeRecord[],
  checkpoint: string
): PushMessage {
  return {
    ...createEnvelope('push'),
    type: 'push',
    payload: { sessionId, changes, checkpoint },
  };
}

/** Create a pull message. */
export function createPull(
  sessionId: string,
  checkpoint: string,
  collections?: string[],
  limit?: number
): PullMessage {
  return {
    ...createEnvelope('pull'),
    type: 'pull',
    payload: { sessionId, checkpoint, collections, limit },
  };
}
