/**
 * Binary codec implementing simplified protobuf-like encoding for USP messages.
 *
 * Supports varint encoding, length-delimited fields, nested messages,
 * repeated/packed fields, and float/double via DataView.
 */

import type {
  ProtoMessageDescriptor,
  ProtoFieldDescriptor,
  MessageCodec,
  ProtocolConfig,
  WireType,
} from './types.js';
import { findMessageDescriptor, isScalarType } from './schema.js';

// ─── Varint Encoding ────────────────────────────────────────────

/** Encode an unsigned integer as a varint into a buffer. Returns bytes written. */
export function encodeVarint(value: number, buffer: Uint8Array, offset: number): number {
  let v = value >>> 0; // ensure unsigned 32-bit
  let written = 0;
  while (v > 0x7f) {
    buffer[offset + written] = (v & 0x7f) | 0x80;
    v >>>= 7;
    written++;
  }
  buffer[offset + written] = v;
  return written + 1;
}

/** Decode a varint from a buffer. Returns [value, bytesRead]. */
export function decodeVarint(buffer: Uint8Array, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  let byte = 0;
  do {
    if (offset + bytesRead >= buffer.length) {
      throw new Error('Varint decode: unexpected end of buffer');
    }
    byte = buffer[offset + bytesRead]!;
    result |= (byte & 0x7f) << shift;
    shift += 7;
    bytesRead++;
    if (bytesRead > 5) {
      throw new Error('Varint decode: value too large for 32-bit integer');
    }
  } while (byte & 0x80);
  return [result >>> 0, bytesRead];
}

/** Encode a signed integer using ZigZag encoding. */
export function zigzagEncode(value: number): number {
  return ((value << 1) ^ (value >> 31)) >>> 0;
}

/** Decode a ZigZag-encoded integer. */
export function zigzagDecode(value: number): number {
  return ((value >>> 1) ^ -(value & 1)) | 0;
}

/** Get the varint size of a number. */
function varintSize(value: number): number {
  let v = value >>> 0;
  let size = 1;
  while (v > 0x7f) {
    v >>>= 7;
    size++;
  }
  return size;
}

// ─── Wire Type Helpers ──────────────────────────────────────────

function wireTypeForField(field: ProtoFieldDescriptor): WireType {
  switch (field.type) {
    case 'double':
    case 'fixed64':
    case 'sfixed64':
      return 1; // 64-bit
    case 'float':
    case 'fixed32':
    case 'sfixed32':
      return 5; // 32-bit
    case 'string':
    case 'bytes':
      return 2; // length-delimited
    case 'int32': case 'int64': case 'uint32': case 'uint64':
    case 'sint32': case 'sint64': case 'bool':
      return 0; // varint
    default:
      // Enum or nested message — enum as varint, message as length-delimited
      if (isScalarType(field.type)) return 0;
      return 2; // nested message
  }
}

function makeTag(fieldNumber: number, wireType: WireType): number {
  return ((fieldNumber << 3) | wireType) >>> 0;
}

function parseTag(tag: number): { fieldNumber: number; wireType: WireType } {
  return {
    fieldNumber: tag >>> 3,
    wireType: (tag & 0x07) as WireType,
  };
}

// ─── Text Encoder / Decoder ─────────────────────────────────────

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ─── Binary Codec ───────────────────────────────────────────────

/** Lightweight binary codec implementing protobuf-like encoding. */
export class BinaryCodec {
  private readonly config: ProtocolConfig;

  constructor(config: ProtocolConfig = {}) {
    this.config = {
      maxMessageSize: 16 * 1024 * 1024, // 16 MB default
      validateOnDecode: true,
      ...config,
    };
  }

  /** Encode a message according to its descriptor. */
  encode<T extends object>(message: T, descriptor: ProtoMessageDescriptor): Uint8Array {
    const msg = message as Record<string, unknown>;
    const size = this.getSize(msg, descriptor);
    if (this.config.maxMessageSize && size > this.config.maxMessageSize) {
      throw new Error(`Message size ${size} exceeds max ${this.config.maxMessageSize}`);
    }
    const buffer = new Uint8Array(size);
    this.writeMessage(msg, descriptor, buffer, 0);
    return buffer;
  }

  /** Decode a message from binary data according to its descriptor. */
  decode<T extends object>(data: Uint8Array, descriptor: ProtoMessageDescriptor): T {
    const [result] = this.readMessage(data, 0, data.length, descriptor);
    return result as T;
  }

  /** Create a typed codec for a specific message descriptor. */
  createCodec<T extends object>(descriptor: ProtoMessageDescriptor): MessageCodec<T> {
    return {
      encode: (message: T) => this.encode(message, descriptor),
      decode: (data: Uint8Array) => this.decode<T>(data, descriptor),
      messageType: descriptor.name,
      descriptor,
    };
  }

  /** Calculate the encoded size of a message. */
  getSize(message: unknown, descriptor: ProtoMessageDescriptor): number {
    const msg = message as Record<string, unknown>;
    let size = 0;

    for (const field of descriptor.fields) {
      const value = msg[field.name];
      if (value === undefined || value === null) continue;

      if (field.repeated && Array.isArray(value)) {
        for (const item of value) {
          size += this.fieldSize(field, item);
        }
      } else if (field.mapKeyType && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        for (const [k, v] of entries) {
          size += this.mapEntrySize(field, k, v);
        }
      } else {
        size += this.fieldSize(field, value);
      }
    }

    return size;
  }

  // ─── Private: Size Calculation ──────────────────────────────

  private fieldSize(field: ProtoFieldDescriptor, value: unknown): number {
    const tagSize = varintSize(makeTag(field.fieldNumber, wireTypeForField(field)));
    const contentSize = this.valueSize(field, value);
    return tagSize + contentSize;
  }

  private valueSize(field: ProtoFieldDescriptor, value: unknown): number {
    switch (field.type) {
      case 'bool':
        return 1;
      case 'int32': case 'uint32':
        return varintSize(Number(value) >>> 0);
      case 'int64': case 'uint64':
        return varintSize(Number(value) >>> 0); // simplified: 32-bit range
      case 'sint32':
        return varintSize(zigzagEncode(Number(value)));
      case 'sint64':
        return varintSize(zigzagEncode(Number(value)));
      case 'float': case 'fixed32': case 'sfixed32':
        return 4;
      case 'double': case 'fixed64': case 'sfixed64':
        return 8;
      case 'string': {
        const bytes = textEncoder.encode(String(value));
        return varintSize(bytes.length) + bytes.length;
      }
      case 'bytes': {
        const buf = value instanceof Uint8Array ? value : textEncoder.encode(String(value));
        return varintSize(buf.length) + buf.length;
      }
      default: {
        // Nested message or enum
        const nestedDesc = findMessageDescriptor(field.type);
        if (nestedDesc && typeof value === 'object') {
          const nestedSize = this.getSize(value, nestedDesc);
          return varintSize(nestedSize) + nestedSize;
        }
        // Treat as enum (varint)
        return varintSize(Number(value) >>> 0);
      }
    }
  }

  private mapEntrySize(field: ProtoFieldDescriptor, key: string, value: unknown): number {
    const tagSize = varintSize(makeTag(field.fieldNumber, 2));
    // Map entry: key = field 1, value = field 2
    const keyBytes = textEncoder.encode(key);
    const keyFieldSize = varintSize(makeTag(1, 2)) + varintSize(keyBytes.length) + keyBytes.length;

    let valueFieldSize: number;
    if (field.mapValueType === 'string') {
      const valBytes = textEncoder.encode(String(value));
      valueFieldSize = varintSize(makeTag(2, 2)) + varintSize(valBytes.length) + valBytes.length;
    } else if (field.mapValueType === 'int64' || field.mapValueType === 'int32') {
      valueFieldSize = varintSize(makeTag(2, 0)) + varintSize(Number(value) >>> 0);
    } else {
      const valBytes = textEncoder.encode(String(value));
      valueFieldSize = varintSize(makeTag(2, 2)) + varintSize(valBytes.length) + valBytes.length;
    }

    const entrySize = keyFieldSize + valueFieldSize;
    return tagSize + varintSize(entrySize) + entrySize;
  }

  // ─── Private: Write ─────────────────────────────────────────

  private writeMessage(
    message: Record<string, unknown>,
    descriptor: ProtoMessageDescriptor,
    buffer: Uint8Array,
    offset: number,
  ): number {
    let pos = offset;

    for (const field of descriptor.fields) {
      const value = message[field.name];
      if (value === undefined || value === null) continue;

      if (field.repeated && Array.isArray(value)) {
        for (const item of value) {
          pos = this.writeField(field, item, buffer, pos);
        }
      } else if (field.mapKeyType && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        for (const [k, v] of entries) {
          pos = this.writeMapEntry(field, k, v, buffer, pos);
        }
      } else {
        pos = this.writeField(field, value, buffer, pos);
      }
    }

    return pos;
  }

  private writeField(field: ProtoFieldDescriptor, value: unknown, buffer: Uint8Array, offset: number): number {
    let pos = offset;
    const wt = wireTypeForField(field);
    const tag = makeTag(field.fieldNumber, wt);
    pos += encodeVarint(tag, buffer, pos);
    pos = this.writeValue(field, value, buffer, pos);
    return pos;
  }

  private writeValue(field: ProtoFieldDescriptor, value: unknown, buffer: Uint8Array, offset: number): number {
    let pos = offset;

    switch (field.type) {
      case 'bool':
        buffer[pos] = value ? 1 : 0;
        return pos + 1;

      case 'int32': case 'uint32': case 'int64': case 'uint64':
        pos += encodeVarint(Number(value) >>> 0, buffer, pos);
        return pos;

      case 'sint32': case 'sint64':
        pos += encodeVarint(zigzagEncode(Number(value)), buffer, pos);
        return pos;

      case 'float': {
        const fView = new DataView(buffer.buffer, buffer.byteOffset + pos, 4);
        fView.setFloat32(0, Number(value), true);
        return pos + 4;
      }
      case 'fixed32': case 'sfixed32': {
        const f32View = new DataView(buffer.buffer, buffer.byteOffset + pos, 4);
        f32View.setUint32(0, Number(value) >>> 0, true);
        return pos + 4;
      }
      case 'double': {
        const dView = new DataView(buffer.buffer, buffer.byteOffset + pos, 8);
        dView.setFloat64(0, Number(value), true);
        return pos + 8;
      }
      case 'fixed64': case 'sfixed64': {
        const d64View = new DataView(buffer.buffer, buffer.byteOffset + pos, 8);
        d64View.setBigUint64(0, BigInt(Number(value)), true);
        return pos + 8;
      }
      case 'string': {
        const strBytes = textEncoder.encode(String(value));
        pos += encodeVarint(strBytes.length, buffer, pos);
        buffer.set(strBytes, pos);
        return pos + strBytes.length;
      }
      case 'bytes': {
        const buf = value instanceof Uint8Array ? value : textEncoder.encode(String(value));
        pos += encodeVarint(buf.length, buffer, pos);
        buffer.set(buf, pos);
        return pos + buf.length;
      }
      default: {
        // Nested message or enum
        const nestedDesc = findMessageDescriptor(field.type);
        if (nestedDesc && typeof value === 'object') {
          const nestedSize = this.getSize(value, nestedDesc);
          pos += encodeVarint(nestedSize, buffer, pos);
          pos = this.writeMessage(value as Record<string, unknown>, nestedDesc, buffer, pos);
          return pos;
        }
        // Enum value (varint)
        pos += encodeVarint(Number(value) >>> 0, buffer, pos);
        return pos;
      }
    }
  }

  private writeMapEntry(
    field: ProtoFieldDescriptor,
    key: string,
    value: unknown,
    buffer: Uint8Array,
    offset: number,
  ): number {
    let pos = offset;
    const tag = makeTag(field.fieldNumber, 2);
    pos += encodeVarint(tag, buffer, pos);

    // Calculate entry size
    const keyBytes = textEncoder.encode(key);
    const keyFieldSize = varintSize(makeTag(1, 2)) + varintSize(keyBytes.length) + keyBytes.length;

    let valueFieldSize: number;
    let writeValueFn: (buf: Uint8Array, off: number) => number;

    if (field.mapValueType === 'int64' || field.mapValueType === 'int32') {
      const numVal = Number(value) >>> 0;
      valueFieldSize = varintSize(makeTag(2, 0)) + varintSize(numVal);
      writeValueFn = (buf, off) => {
        let p = off;
        p += encodeVarint(makeTag(2, 0), buf, p);
        p += encodeVarint(numVal, buf, p);
        return p;
      };
    } else {
      const valBytes = textEncoder.encode(String(value));
      valueFieldSize = varintSize(makeTag(2, 2)) + varintSize(valBytes.length) + valBytes.length;
      writeValueFn = (buf, off) => {
        let p = off;
        p += encodeVarint(makeTag(2, 2), buf, p);
        p += encodeVarint(valBytes.length, buf, p);
        buf.set(valBytes, p);
        return p + valBytes.length;
      };
    }

    const entrySize = keyFieldSize + valueFieldSize;
    pos += encodeVarint(entrySize, buffer, pos);

    // Write key (field 1, length-delimited)
    pos += encodeVarint(makeTag(1, 2), buffer, pos);
    pos += encodeVarint(keyBytes.length, buffer, pos);
    buffer.set(keyBytes, pos);
    pos += keyBytes.length;

    // Write value
    pos = writeValueFn(buffer, pos);

    return pos;
  }

  // ─── Private: Read ──────────────────────────────────────────

  private readMessage(
    data: Uint8Array,
    offset: number,
    end: number,
    descriptor: ProtoMessageDescriptor,
  ): [Record<string, unknown>, number] {
    const result: Record<string, unknown> = {};
    const fieldMap = new Map<number, ProtoFieldDescriptor>();
    for (const f of descriptor.fields) {
      fieldMap.set(f.fieldNumber, f);
      // Initialize repeated fields and maps
      if (f.repeated) result[f.name] = [];
      if (f.mapKeyType) result[f.name] = {};
    }

    let pos = offset;
    while (pos < end) {
      const [tag, tagBytes] = decodeVarint(data, pos);
      pos += tagBytes;
      const { fieldNumber, wireType } = parseTag(tag);
      const field = fieldMap.get(fieldNumber);

      if (!field) {
        // Skip unknown field
        pos = this.skipField(data, pos, wireType);
        continue;
      }

      if (field.mapKeyType) {
        // Map entry: length-delimited
        const [entryLen, entryLenBytes] = decodeVarint(data, pos);
        pos += entryLenBytes;
        const entryEnd = pos + entryLen;
        const [mapKey, mapValue] = this.readMapEntry(data, pos, entryEnd, field);
        (result[field.name] as Record<string, unknown>)[mapKey] = mapValue;
        pos = entryEnd;
      } else if (field.repeated) {
        const value = this.readValue(data, pos, field, wireType);
        (result[field.name] as unknown[]).push(value[0]);
        pos = value[1];
      } else {
        const value = this.readValue(data, pos, field, wireType);
        result[field.name] = value[0];
        pos = value[1];
      }
    }

    return [result, pos];
  }

  private readValue(
    data: Uint8Array,
    offset: number,
    field: ProtoFieldDescriptor,
    wireType: WireType,
  ): [unknown, number] {
    let pos = offset;

    switch (wireType) {
      case 0: { // varint
        const [value, bytes] = decodeVarint(data, pos);
        pos += bytes;
        if (field.type === 'bool') return [value !== 0, pos];
        if (field.type === 'sint32' || field.type === 'sint64') return [zigzagDecode(value), pos];
        return [value, pos];
      }
      case 1: { // 64-bit
        const view = new DataView(data.buffer, data.byteOffset + pos, 8);
        if (field.type === 'double') return [view.getFloat64(0, true), pos + 8];
        return [Number(view.getBigUint64(0, true)), pos + 8];
      }
      case 2: { // length-delimited
        const [len, lenBytes] = decodeVarint(data, pos);
        pos += lenBytes;
        if (field.type === 'string') {
          const str = textDecoder.decode(data.subarray(pos, pos + len));
          return [str, pos + len];
        }
        if (field.type === 'bytes') {
          return [data.slice(pos, pos + len), pos + len];
        }
        // Nested message
        const nestedDesc = findMessageDescriptor(field.type);
        if (nestedDesc) {
          const [nested] = this.readMessage(data, pos, pos + len, nestedDesc);
          return [nested, pos + len];
        }
        // Fallback: treat as bytes
        return [data.slice(pos, pos + len), pos + len];
      }
      case 5: { // 32-bit
        const fView = new DataView(data.buffer, data.byteOffset + pos, 4);
        if (field.type === 'float') return [fView.getFloat32(0, true), pos + 4];
        return [fView.getUint32(0, true), pos + 4];
      }
      default:
        throw new Error(`Unknown wire type: ${wireType}`);
    }
  }

  private readMapEntry(
    data: Uint8Array,
    offset: number,
    end: number,
    _field: ProtoFieldDescriptor,
  ): [string, unknown] {
    let key = '';
    let value: unknown = '';
    let pos = offset;

    while (pos < end) {
      const [tag, tagBytes] = decodeVarint(data, pos);
      pos += tagBytes;
      const { fieldNumber, wireType } = parseTag(tag);

      if (fieldNumber === 1) {
        // Key (always string for our use case)
        const [len, lenBytes] = decodeVarint(data, pos);
        pos += lenBytes;
        key = textDecoder.decode(data.subarray(pos, pos + len));
        pos += len;
      } else if (fieldNumber === 2) {
        if (wireType === 0) {
          // Varint value
          const [v, bytes] = decodeVarint(data, pos);
          pos += bytes;
          value = v;
        } else if (wireType === 2) {
          // Length-delimited value (string)
          const [len, lenBytes] = decodeVarint(data, pos);
          pos += lenBytes;
          value = textDecoder.decode(data.subarray(pos, pos + len));
          pos += len;
        } else {
          pos = this.skipField(data, pos, wireType);
        }
      } else {
        pos = this.skipField(data, pos, wireType);
      }
    }

    return [key, value];
  }

  private skipField(data: Uint8Array, offset: number, wireType: WireType): number {
    switch (wireType) {
      case 0: { // varint
        const [, bytes] = decodeVarint(data, offset);
        return offset + bytes;
      }
      case 1: // 64-bit
        return offset + 8;
      case 2: { // length-delimited
        const [len, lenBytes] = decodeVarint(data, offset);
        return offset + lenBytes + len;
      }
      case 5: // 32-bit
        return offset + 4;
      default:
        throw new Error(`Cannot skip unknown wire type: ${wireType}`);
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a new binary codec instance. */
export function createBinaryCodec(config?: ProtocolConfig): BinaryCodec {
  return new BinaryCodec(config);
}
