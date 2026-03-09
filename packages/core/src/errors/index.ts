/**
 * Pocket Error System
 *
 * This module provides structured error handling with:
 * - Unique error codes (POCKET_V101, POCKET_Q201, etc.)
 * - Helpful suggestions for resolution
 * - Links to documentation
 * - Error categorization
 * - Proper error chaining
 *
 * @example
 * ```typescript
 * import { PocketError, ValidationError, DocumentNotFoundError } from '@pocket/core';
 *
 * // Throw a typed error
 * throw new DocumentNotFoundError('users', 'user-123');
 *
 * // Catch and handle
 * try {
 *   await collection.update(id, changes);
 * } catch (error) {
 *   if (PocketError.isCode(error, 'POCKET_D401')) {
 *     console.log('Document not found');
 *   } else if (PocketError.isCategory(error, 'validation')) {
 *     console.log('Validation failed:', error.format());
 *   }
 * }
 * ```
 *
 * @module errors
 */

// Error codes
export {
  ERROR_CODES,
  getErrorCategory,
  getErrorInfo,
  type ErrorCategory,
  type ErrorCode,
} from './error-codes.js';

// Error classes
export {
  ConnectionError,
  DocumentDeletedError,
  DocumentNotFoundError,
  IndexError,
  MigrationError,
  PocketError,
  QueryError,
  StorageError,
  ensurePocketError,
  type PocketErrorOptions,
  type SerializedPocketError,
} from './pocket-error.js';

// Re-export collection's ValidationError (the canonical version, extends PocketError)
export { ValidationError } from '../database/collection.js';
