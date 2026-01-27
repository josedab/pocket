import { StorageError } from '@pocket/core';

/**
 * Crypto utilities for browser and Node.js environments
 */

/**
 * Get the Web Crypto API
 */
export function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  throw new StorageError('POCKET_S301', 'Web Crypto API not available', {
    operation: 'getCrypto',
  });
}

/**
 * Get the SubtleCrypto API
 */
export function getSubtleCrypto(): SubtleCrypto {
  return getCrypto().subtle;
}

/**
 * Generate random bytes
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

/**
 * Generate a random UUID
 */
export function randomUUID(): string {
  return getCrypto().randomUUID();
}

/**
 * Encode bytes to base64
 */
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  // Browser fallback
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Decode base64 to bytes
 */
export function fromBase64(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  // Browser fallback
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode string to bytes
 */
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Decode bytes to string
 */
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

/**
 * Compare two byte arrays in constant time
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }

  return result === 0;
}

/**
 * Simple compression using built-in CompressionStream (if available)
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    // No compression available, return as-is
    return data;
  }

  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(data as unknown as BufferSource);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();

  let result = await reader.read();
  while (!result.done) {
    chunks.push(result.value);
    result = await reader.read();
  }

  return concatBytes(...chunks);
}

/**
 * Simple decompression using built-in DecompressionStream (if available)
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    // No decompression available, return as-is
    return data;
  }

  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  void writer.write(data as unknown as BufferSource);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();

  let result = await reader.read();
  while (!result.done) {
    chunks.push(result.value);
    result = await reader.read();
  }

  return concatBytes(...chunks);
}
