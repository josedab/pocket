/**
 * Input validation utilities for Pocket core.
 *
 * Provides reusable validators for collection names, document IDs,
 * field paths, and query parameters. Used internally by the database
 * engine and exported for plugin authors.
 *
 * @module validation
 */

import { ValidationError, type FieldValidationError } from '../errors/pocket-error.js';

/** Validation result */
export interface InputValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function toFieldErrors(errors: string[]): FieldValidationError[] {
  return errors.map((msg) => ({ path: '', message: msg, value: undefined }));
}

// ── Collection Name Validation ───────────────────────────────────────────────

const COLLECTION_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;
const RESERVED_COLLECTIONS = new Set(['_system', '_metadata', '_migrations', '_sync', '__proto__']);

/** Validate a collection name */
export function validateCollectionName(name: unknown): InputValidationResult {
  const errors: string[] = [];
  if (typeof name !== 'string') {
    return { valid: false, errors: ['Collection name must be a string'] };
  }
  if (name.length === 0) {
    errors.push('Collection name cannot be empty');
  } else if (name.length > 64) {
    errors.push(`Collection name too long (${name.length} chars, max 64)`);
  } else if (!COLLECTION_NAME_PATTERN.test(name)) {
    errors.push('Collection name must start with a letter or underscore and contain only alphanumeric characters, underscores, or hyphens');
  }
  if (RESERVED_COLLECTIONS.has(name)) {
    errors.push(`"${name}" is a reserved collection name`);
  }
  return { valid: errors.length === 0, errors };
}

/** Assert a collection name is valid, throwing ValidationError if not */
export function assertCollectionName(name: unknown): asserts name is string {
  const result = validateCollectionName(name);
  if (!result.valid) {
    throw new ValidationError(toFieldErrors([...result.errors]));
  }
}

// ── Document ID Validation ───────────────────────────────────────────────────

/** Validate a document ID */
export function validateDocumentId(id: unknown): InputValidationResult {
  const errors: string[] = [];
  if (typeof id !== 'string') {
    return { valid: false, errors: ['Document ID must be a string'] };
  }
  if (id.length === 0) errors.push('Document ID cannot be empty');
  else if (id.length > 256) errors.push(`Document ID too long (${id.length} chars, max 256)`);
  if (id.includes('\0')) errors.push('Document ID cannot contain null bytes');
  return { valid: errors.length === 0, errors };
}

/** Assert a document ID is valid */
export function assertDocumentId(id: unknown): asserts id is string {
  const result = validateDocumentId(id);
  if (!result.valid) throw new ValidationError(toFieldErrors([...result.errors]));
}

// ── Field Path Validation ────────────────────────────────────────────────────

const FIELD_PATH_PATTERN = /^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/;
const DANGEROUS_PATHS = new Set(['__proto__', 'constructor', 'prototype']);

/** Validate a field path (e.g., "user.name") */
export function validateFieldPath(path: unknown): InputValidationResult {
  const errors: string[] = [];
  if (typeof path !== 'string') {
    return { valid: false, errors: ['Field path must be a string'] };
  }
  if (path.length === 0) errors.push('Field path cannot be empty');
  else if (!FIELD_PATH_PATTERN.test(path)) errors.push('Field path contains invalid characters');
  for (const segment of path.split('.')) {
    if (DANGEROUS_PATHS.has(segment)) {
      errors.push(`Field path contains dangerous segment "${segment}"`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Assert a field path is valid */
export function assertFieldPath(path: unknown): asserts path is string {
  const result = validateFieldPath(path);
  if (!result.valid) throw new ValidationError(toFieldErrors([...result.errors]));
}

// ── Pagination Validation ────────────────────────────────────────────────────

/** Validate pagination parameters */
export function validatePagination(limit?: unknown, skip?: unknown): InputValidationResult {
  const errors: string[] = [];
  if (limit !== undefined) {
    if (typeof limit !== 'number' || !Number.isInteger(limit)) errors.push('Limit must be an integer');
    else if (limit < 0) errors.push('Limit cannot be negative');
    else if (limit > 10_000) errors.push('Limit exceeds maximum of 10,000');
  }
  if (skip !== undefined) {
    if (typeof skip !== 'number' || !Number.isInteger(skip)) errors.push('Skip must be an integer');
    else if (skip < 0) errors.push('Skip cannot be negative');
  }
  return { valid: errors.length === 0, errors };
}

// ── Document Body Validation ─────────────────────────────────────────────────

/** Validate a document body for insertion */
export function validateDocumentBody(doc: unknown): InputValidationResult {
  const errors: string[] = [];
  if (doc === null || doc === undefined) {
    return { valid: false, errors: ['Document cannot be null or undefined'] };
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['Document must be a plain object'] };
  }
  for (const key of Object.keys(doc as Record<string, unknown>)) {
    if (DANGEROUS_PATHS.has(key)) {
      errors.push(`Document key "${key}" is not allowed (prototype pollution risk)`);
    }
  }
  try {
    const json = JSON.stringify(doc);
    if (json.length > 16 * 1024 * 1024) {
      errors.push('Document exceeds maximum size of 16MB');
    }
  } catch {
    errors.push('Document contains non-serializable values');
  }
  return { valid: errors.length === 0, errors };
}
