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
 * Code examples for common error scenarios.
 * These help developers quickly understand how to fix issues.
 */
const ERROR_CODE_EXAMPLES: Partial<Record<ErrorCode, string>> = {
  POCKET_V100: `// Ensure your document matches the schema:
const user = await db.collection('users').insert({
  name: 'John',  // required field
  email: 'john@example.com',  // must match pattern
});`,

  POCKET_V101: `// Add all required fields to your document:
await db.collection('users').insert({
  _id: 'user-1',
  name: 'Required field',  // Don't forget required fields!
});`,

  POCKET_D401: `// Check if the document exists before accessing:
const doc = await db.collection('users').get('user-123');
if (!doc) {
  console.log('Document not found');
}`,

  POCKET_D403: `// Use upsert to handle duplicate IDs:
await db.collection('users').upsert({
  _id: 'existing-id',
  name: 'Updated name',
});`,

  POCKET_Q200: `// Ensure collection exists and query is valid:
const results = await db.collection('users')
  .find()
  .where('age').gte(18)
  .exec();`,

  POCKET_Q203: `// Add an index to speed up queries:
// In pocket.config.ts:
collections: {
  users: {
    indexes: [{ fields: ['email'], unique: true }]
  }
}`,

  POCKET_S301: `// Check storage adapter availability:
import { createIndexedDBStorage } from '@pocket/storage-indexeddb';

const storage = createIndexedDBStorage();
if (!storage.isAvailable()) {
  // Fall back to memory storage
}`,

  POCKET_C501: `// Configure sync with retry logic:
const sync = createSyncEngine(db, {
  serverUrl: 'wss://your-server.com',
  reconnect: true,
  reconnectDelay: 1000,
});`,

  POCKET_I603: `// Handle unique constraint violations:
try {
  await db.collection('users').insert({ email: 'exists@example.com' });
} catch (e) {
  if (PocketError.isCode(e, 'POCKET_I603')) {
    console.log('Email already exists');
  }
}`,

  POCKET_M700: `// Check migration file syntax:
// migrations/001_add_users.ts
export async function up(ctx) {
  await ctx.createCollection('users');
}

export async function down(ctx) {
  await ctx.dropCollection('users');
}`,
};

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
   * Format the error for display (basic format)
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
   * Format the error for terminal display with colors and clickable links.
   * Uses ANSI escape codes for styling.
   */
  formatTerminal(): string {
    const red = '\x1b[31m';
    const yellow = '\x1b[33m';
    const cyan = '\x1b[36m';
    const dim = '\x1b[2m';
    const bold = '\x1b[1m';
    const reset = '\x1b[0m';
    const underline = '\x1b[4m';

    const lines: string[] = [];

    // Error header with code
    lines.push(`${red}${bold}Error [${this.code}]${reset} ${this.message}`);
    lines.push('');

    // Context (if any)
    if (Object.keys(this.context).length > 0) {
      lines.push(`${dim}Context:${reset}`);
      for (const [key, value] of Object.entries(this.context)) {
        const displayValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        lines.push(`  ${cyan}${key}${reset}: ${displayValue}`);
      }
      lines.push('');
    }

    // Suggestion
    if (this.suggestion) {
      lines.push(`${yellow}${bold}Suggestion:${reset} ${this.suggestion}`);
    }

    // Clickable documentation link (OSC 8 hyperlink escape sequence)
    // Format: \x1b]8;;URL\x07LINK_TEXT\x1b]8;;\x07
    if (this.docsUrl) {
      const clickableLink = `\x1b]8;;${this.docsUrl}\x07${underline}${cyan}${this.docsUrl}${reset}\x1b]8;;\x07`;
      lines.push(`${dim}Learn more:${reset} ${clickableLink}`);
    }

    return lines.join('\n');
  }

  /**
   * Get a helpful code example for this error type (if available)
   */
  getCodeExample(): string | null {
    return ERROR_CODE_EXAMPLES[this.code] ?? null;
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
