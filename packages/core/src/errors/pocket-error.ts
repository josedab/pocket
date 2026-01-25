/**
 * PocketError - Enhanced error class with structured error information
 */

import {
  type ErrorCategory,
  type ErrorCode,
  getErrorCategory,
  getErrorInfo,
} from './error-codes.js';

/**
 * Options for creating a PocketError
 */
export interface PocketErrorOptions {
  /** The error code */
  code: ErrorCode;
  /** Custom message (overrides default) */
  message?: string;
  /** Custom suggestion (overrides default) */
  suggestion?: string;
  /** Additional context information */
  context?: Record<string, unknown>;
  /** The original error that caused this error */
  cause?: Error;
}

/**
 * Serialized format of a PocketError
 */
export interface SerializedPocketError {
  name: string;
  code: string;
  message: string;
  suggestion?: string;
  docsUrl?: string;
  category: ErrorCategory;
  context: Record<string, unknown>;
  stack?: string;
  cause?: SerializedPocketError | { name: string; message: string; stack?: string };
}

/**
 * Enhanced error class for Pocket with structured error information.
 *
 * PocketError provides:
 * - Unique error codes for categorization
 * - Helpful suggestions for resolution
 * - Links to documentation
 * - Context information for debugging
 * - Proper error chaining with cause
 *
 * @example
 * ```typescript
 * throw new PocketError({
 *   code: 'POCKET_D401',
 *   context: { documentId: 'user-123' }
 * });
 *
 * // Or with custom message
 * throw new PocketError({
 *   code: 'POCKET_V100',
 *   message: 'User validation failed',
 *   context: { field: 'email', value: 'invalid' }
 * });
 * ```
 */
export class PocketError extends Error {
  /** Unique error code */
  readonly code: ErrorCode;

  /** Helpful suggestion for resolving the error */
  readonly suggestion?: string;

  /** URL to relevant documentation */
  readonly docsUrl?: string;

  /** Error category for grouping */
  readonly category: ErrorCategory;

  /** Additional context information */
  readonly context: Record<string, unknown>;

  /** Original error that caused this error */
  override readonly cause?: Error;

  constructor(options: PocketErrorOptions) {
    const errorInfo = getErrorInfo(options.code);
    const message = options.message ?? errorInfo.message;

    super(message, { cause: options.cause });

    this.name = 'PocketError';
    this.code = options.code;
    this.suggestion = options.suggestion ?? errorInfo.suggestion;
    this.docsUrl = errorInfo.docsUrl;
    this.category = getErrorCategory(options.code);
    this.context = options.context ?? {};
    this.cause = options.cause;

    // Maintain proper stack trace for V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PocketError);
    }
  }

  /**
   * Create a PocketError from an error code with minimal options
   */
  static fromCode(code: ErrorCode, context?: Record<string, unknown>): PocketError {
    return new PocketError({ code, context });
  }

  /**
   * Wrap an existing error with a PocketError
   */
  static wrap(error: Error, code: ErrorCode, context?: Record<string, unknown>): PocketError {
    return new PocketError({
      code,
      message: error.message,
      context,
      cause: error,
    });
  }

  /**
   * Check if an error is a PocketError
   */
  static isPocketError(error: unknown): error is PocketError {
    return error instanceof PocketError;
  }

  /**
   * Check if an error matches a specific code
   */
  static isCode(error: unknown, code: ErrorCode): boolean {
    return PocketError.isPocketError(error) && error.code === code;
  }

  /**
   * Check if an error matches a specific category
   */
  static isCategory(error: unknown, category: ErrorCategory): boolean {
    return PocketError.isPocketError(error) && error.category === category;
  }

  /**
   * Format the error for display
   */
  format(): string {
    const lines = [`[${this.code}] ${this.message}`];

    if (Object.keys(this.context).length > 0) {
      lines.push(`Context: ${JSON.stringify(this.context)}`);
    }

    if (this.suggestion) {
      lines.push(`Suggestion: ${this.suggestion}`);
    }

    if (this.docsUrl) {
      lines.push(`Docs: ${this.docsUrl}`);
    }

    return lines.join('\n');
  }

  /**
   * Convert to a plain object for serialization
   */
  toJSON(): SerializedPocketError {
    const result: SerializedPocketError = {
      name: this.name,
      code: this.code,
      message: this.message,
      category: this.category,
      context: this.context,
    };

    if (this.suggestion) {
      result.suggestion = this.suggestion;
    }

    if (this.docsUrl) {
      result.docsUrl = this.docsUrl;
    }

    if (this.stack) {
      result.stack = this.stack;
    }

    if (this.cause) {
      if (PocketError.isPocketError(this.cause)) {
        result.cause = this.cause.toJSON();
      } else {
        result.cause = {
          name: this.cause.name,
          message: this.cause.message,
          stack: this.cause.stack,
        };
      }
    }

    return result;
  }

  /**
   * Override toString for better console output
   */
  override toString(): string {
    return this.format();
  }
}

/**
 * Validation-specific error with field-level details
 */
export class ValidationError extends PocketError {
  /** Field-level validation errors */
  readonly errors: FieldValidationError[];

  constructor(errors: FieldValidationError[], context?: Record<string, unknown>) {
    const message = errors.map((e) => `${e.path}: ${e.message}`).join('; ');

    super({
      code: 'POCKET_V100',
      message: `Validation failed: ${message}`,
      context: {
        ...context,
        fieldErrors: errors,
      },
    });

    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/**
 * Field validation error detail
 */
export interface FieldValidationError {
  /** Field path (e.g., 'address.city' or 'items[0].name') */
  path: string;
  /** Human-readable error message */
  message: string;
  /** The actual value that failed validation */
  value?: unknown;
  /** The constraint that was violated */
  constraint?: string;
}

/**
 * Document not found error
 */
export class DocumentNotFoundError extends PocketError {
  /** The document ID that was not found */
  readonly documentId: string;
  /** The collection name */
  readonly collection: string;

  constructor(collection: string, documentId: string) {
    super({
      code: 'POCKET_D401',
      message: `Document with id "${documentId}" not found in collection "${collection}"`,
      context: { collection, documentId },
    });

    this.name = 'DocumentNotFoundError';
    this.documentId = documentId;
    this.collection = collection;
  }
}

/**
 * Document deleted error
 */
export class DocumentDeletedError extends PocketError {
  /** The document ID that was deleted */
  readonly documentId: string;
  /** The collection name */
  readonly collection: string;

  constructor(collection: string, documentId: string) {
    super({
      code: 'POCKET_D402',
      message: `Document with id "${documentId}" has been deleted from collection "${collection}"`,
      context: { collection, documentId },
    });

    this.name = 'DocumentDeletedError';
    this.documentId = documentId;
    this.collection = collection;
  }
}

/**
 * Query error
 */
export class QueryError extends PocketError {
  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: Error) {
    super({ code, message, context, cause });
    this.name = 'QueryError';
  }
}

/**
 * Storage error
 */
export class StorageError extends PocketError {
  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: Error) {
    super({ code, message, context, cause });
    this.name = 'StorageError';
  }
}

/**
 * Connection error
 */
export class ConnectionError extends PocketError {
  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: Error) {
    super({ code, message, context, cause });
    this.name = 'ConnectionError';
  }
}

/**
 * Index error
 */
export class IndexError extends PocketError {
  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: Error) {
    super({ code, message, context, cause });
    this.name = 'IndexError';
  }
}

/**
 * Migration error
 */
export class MigrationError extends PocketError {
  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: Error) {
    super({ code, message, context, cause });
    this.name = 'MigrationError';
  }
}

/**
 * Helper function to ensure errors are PocketErrors
 */
export function ensurePocketError(
  error: unknown,
  defaultCode: ErrorCode = 'POCKET_X900'
): PocketError {
  if (PocketError.isPocketError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return PocketError.wrap(error, defaultCode);
  }

  return new PocketError({
    code: defaultCode,
    message: String(error),
  });
}
