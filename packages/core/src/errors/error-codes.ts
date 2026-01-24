/**
 * Pocket Error Codes
 *
 * Error codes are structured as POCKET_[CATEGORY][NUMBER]:
 * - V: Validation errors (V100-V199)
 * - Q: Query errors (Q200-Q299)
 * - S: Storage errors (S300-S399)
 * - D: Document errors (D400-D499)
 * - C: Connection/Sync errors (C500-C599)
 * - I: Index errors (I600-I699)
 * - M: Migration errors (M700-M799)
 * - P: Plugin errors (P800-P899)
 * - X: Internal errors (X900-X999)
 */

/**
 * Error code definitions with messages and suggestions
 */
export const ERROR_CODES = {
  // Validation errors (V100-V199)
  POCKET_V100: {
    code: 'POCKET_V100',
    message: 'Validation failed',
    suggestion: 'Check the validation errors for specific field issues.',
    docsUrl: 'https://pocket.dev/docs/errors/validation',
  },
  POCKET_V101: {
    code: 'POCKET_V101',
    message: 'Required field is missing',
    suggestion: 'Ensure all required fields are provided in the document.',
    docsUrl: 'https://pocket.dev/docs/errors/validation#required-fields',
  },
  POCKET_V102: {
    code: 'POCKET_V102',
    message: 'Invalid field type',
    suggestion: 'Check that the field value matches the expected type in the schema.',
    docsUrl: 'https://pocket.dev/docs/errors/validation#type-mismatch',
  },
  POCKET_V103: {
    code: 'POCKET_V103',
    message: 'Value out of range',
    suggestion: 'Ensure numeric values are within the min/max constraints.',
    docsUrl: 'https://pocket.dev/docs/errors/validation#range',
  },
  POCKET_V104: {
    code: 'POCKET_V104',
    message: 'Pattern validation failed',
    suggestion: 'The string value does not match the required pattern.',
    docsUrl: 'https://pocket.dev/docs/errors/validation#pattern',
  },
  POCKET_V105: {
    code: 'POCKET_V105',
    message: 'Invalid enum value',
    suggestion: 'The value must be one of the allowed enum options.',
    docsUrl: 'https://pocket.dev/docs/errors/validation#enum',
  },
  POCKET_V106: {
    code: 'POCKET_V106',
    message: 'Unknown field not allowed',
    suggestion:
      'The schema has additionalProperties: false. Remove unknown fields or update the schema.',
    docsUrl: 'https://pocket.dev/docs/errors/validation#additional-properties',
  },

  // Query errors (Q200-Q299)
  POCKET_Q200: {
    code: 'POCKET_Q200',
    message: 'Query execution failed',
    suggestion: 'Check the query syntax and ensure the collection exists.',
    docsUrl: 'https://pocket.dev/docs/errors/query',
  },
  POCKET_Q201: {
    code: 'POCKET_Q201',
    message: 'Invalid query operator',
    suggestion: 'Use a valid query operator: eq, neq, gt, gte, lt, lte, in, nin, etc.',
    docsUrl: 'https://pocket.dev/docs/errors/query#operators',
  },
  POCKET_Q202: {
    code: 'POCKET_Q202',
    message: 'Invalid query field',
    suggestion: 'The field does not exist in the collection schema.',
    docsUrl: 'https://pocket.dev/docs/errors/query#fields',
  },
  POCKET_Q203: {
    code: 'POCKET_Q203',
    message: 'Query timeout exceeded',
    suggestion: 'Add indexes to optimize the query or increase the timeout.',
    docsUrl: 'https://pocket.dev/docs/errors/query#timeout',
  },
  POCKET_Q204: {
    code: 'POCKET_Q204',
    message: 'Invalid cursor value',
    suggestion: 'The cursor value is malformed or has expired.',
    docsUrl: 'https://pocket.dev/docs/errors/query#cursor',
  },
  POCKET_Q205: {
    code: 'POCKET_Q205',
    message: 'Invalid pagination parameters',
    suggestion: 'Ensure offset and limit are non-negative numbers.',
    docsUrl: 'https://pocket.dev/docs/errors/query#pagination',
  },

  // Storage errors (S300-S399)
  POCKET_S300: {
    code: 'POCKET_S300',
    message: 'Storage operation failed',
    suggestion: 'Check storage adapter configuration and available space.',
    docsUrl: 'https://pocket.dev/docs/errors/storage',
  },
  POCKET_S301: {
    code: 'POCKET_S301',
    message: 'Storage adapter not available',
    suggestion: 'The storage adapter is not supported in this environment.',
    docsUrl: 'https://pocket.dev/docs/errors/storage#adapters',
  },
  POCKET_S302: {
    code: 'POCKET_S302',
    message: 'Storage quota exceeded',
    suggestion: 'Clear old data or increase storage quota.',
    docsUrl: 'https://pocket.dev/docs/errors/storage#quota',
  },
  POCKET_S303: {
    code: 'POCKET_S303',
    message: 'Database initialization failed',
    suggestion: 'Check database configuration and permissions.',
    docsUrl: 'https://pocket.dev/docs/errors/storage#initialization',
  },
  POCKET_S304: {
    code: 'POCKET_S304',
    message: 'Transaction aborted',
    suggestion: 'The transaction was aborted due to a conflict or error.',
    docsUrl: 'https://pocket.dev/docs/errors/storage#transactions',
  },

  // Document errors (D400-D499)
  POCKET_D400: {
    code: 'POCKET_D400',
    message: 'Document operation failed',
    suggestion: 'Check the document data and try again.',
    docsUrl: 'https://pocket.dev/docs/errors/document',
  },
  POCKET_D401: {
    code: 'POCKET_D401',
    message: 'Document not found',
    suggestion: 'The document with the specified ID does not exist.',
    docsUrl: 'https://pocket.dev/docs/errors/document#not-found',
  },
  POCKET_D402: {
    code: 'POCKET_D402',
    message: 'Document has been deleted',
    suggestion: 'The document was deleted. You may need to restore it or create a new one.',
    docsUrl: 'https://pocket.dev/docs/errors/document#deleted',
  },
  POCKET_D403: {
    code: 'POCKET_D403',
    message: 'Document ID already exists',
    suggestion: 'Use upsert() or generate a unique ID.',
    docsUrl: 'https://pocket.dev/docs/errors/document#duplicate-id',
  },
  POCKET_D404: {
    code: 'POCKET_D404',
    message: 'Invalid document ID',
    suggestion: 'Document IDs must be non-empty strings.',
    docsUrl: 'https://pocket.dev/docs/errors/document#invalid-id',
  },

  // Connection/Sync errors (C500-C599)
  POCKET_C500: {
    code: 'POCKET_C500',
    message: 'Sync operation failed',
    suggestion: 'Check network connectivity and server status.',
    docsUrl: 'https://pocket.dev/docs/errors/sync',
  },
  POCKET_C501: {
    code: 'POCKET_C501',
    message: 'Connection failed',
    suggestion: 'Unable to connect to sync server. Check the URL and network.',
    docsUrl: 'https://pocket.dev/docs/errors/sync#connection',
  },
  POCKET_C502: {
    code: 'POCKET_C502',
    message: 'Authentication failed',
    suggestion: 'Check your authentication credentials.',
    docsUrl: 'https://pocket.dev/docs/errors/sync#auth',
  },
  POCKET_C503: {
    code: 'POCKET_C503',
    message: 'Sync conflict detected',
    suggestion: 'Review and resolve the conflict using a conflict resolution strategy.',
    docsUrl: 'https://pocket.dev/docs/errors/sync#conflicts',
  },
  POCKET_C504: {
    code: 'POCKET_C504',
    message: 'Connection timeout',
    suggestion: 'The connection timed out. Check network conditions.',
    docsUrl: 'https://pocket.dev/docs/errors/sync#timeout',
  },

  // Index errors (I600-I699)
  POCKET_I600: {
    code: 'POCKET_I600',
    message: 'Index operation failed',
    suggestion: 'Check index configuration and field types.',
    docsUrl: 'https://pocket.dev/docs/errors/index',
  },
  POCKET_I601: {
    code: 'POCKET_I601',
    message: 'Index not found',
    suggestion: 'The specified index does not exist.',
    docsUrl: 'https://pocket.dev/docs/errors/index#not-found',
  },
  POCKET_I602: {
    code: 'POCKET_I602',
    message: 'Duplicate index name',
    suggestion: 'An index with this name already exists.',
    docsUrl: 'https://pocket.dev/docs/errors/index#duplicate',
  },
  POCKET_I603: {
    code: 'POCKET_I603',
    message: 'Unique constraint violation',
    suggestion: 'A document with the same indexed value already exists.',
    docsUrl: 'https://pocket.dev/docs/errors/index#unique-violation',
  },

  // Migration errors (M700-M799)
  POCKET_M700: {
    code: 'POCKET_M700',
    message: 'Migration failed',
    suggestion: 'Check migration file for errors.',
    docsUrl: 'https://pocket.dev/docs/errors/migration',
  },
  POCKET_M701: {
    code: 'POCKET_M701',
    message: 'Migration version mismatch',
    suggestion: 'The database version does not match expected migration state.',
    docsUrl: 'https://pocket.dev/docs/errors/migration#version',
  },
  POCKET_M702: {
    code: 'POCKET_M702',
    message: 'Migration not found',
    suggestion: 'No migration found for the specified version.',
    docsUrl: 'https://pocket.dev/docs/errors/migration#not-found',
  },
  POCKET_M703: {
    code: 'POCKET_M703',
    message: 'Downgrade not supported',
    suggestion: 'This migration does not support rollback.',
    docsUrl: 'https://pocket.dev/docs/errors/migration#downgrade',
  },

  // Plugin errors (P800-P899)
  POCKET_P800: {
    code: 'POCKET_P800',
    message: 'Plugin error',
    suggestion: 'Check plugin configuration and dependencies.',
    docsUrl: 'https://pocket.dev/docs/errors/plugin',
  },
  POCKET_P801: {
    code: 'POCKET_P801',
    message: 'Plugin initialization failed',
    suggestion: 'The plugin failed to initialize. Check plugin logs.',
    docsUrl: 'https://pocket.dev/docs/errors/plugin#init',
  },
  POCKET_P802: {
    code: 'POCKET_P802',
    message: 'Plugin hook error',
    suggestion: 'An error occurred in a plugin hook.',
    docsUrl: 'https://pocket.dev/docs/errors/plugin#hook',
  },

  // Internal errors (X900-X999)
  POCKET_X900: {
    code: 'POCKET_X900',
    message: 'Internal error',
    suggestion: 'An unexpected error occurred. Please report this issue.',
    docsUrl: 'https://pocket.dev/docs/errors/internal',
  },
  POCKET_X901: {
    code: 'POCKET_X901',
    message: 'Assertion failed',
    suggestion: 'An internal assertion failed. Please report this issue.',
    docsUrl: 'https://pocket.dev/docs/errors/internal#assertion',
  },
} as const;

/**
 * Error code type
 */
export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Error category type
 */
export type ErrorCategory =
  | 'validation'
  | 'query'
  | 'storage'
  | 'document'
  | 'connection'
  | 'index'
  | 'migration'
  | 'plugin'
  | 'internal';

/**
 * Get the category of an error code
 */
export function getErrorCategory(code: ErrorCode): ErrorCategory {
  const letter = code.charAt(7);
  switch (letter) {
    case 'V':
      return 'validation';
    case 'Q':
      return 'query';
    case 'S':
      return 'storage';
    case 'D':
      return 'document';
    case 'C':
      return 'connection';
    case 'I':
      return 'index';
    case 'M':
      return 'migration';
    case 'P':
      return 'plugin';
    default:
      return 'internal';
  }
}

/**
 * Get error info by code
 */
export function getErrorInfo(code: ErrorCode): (typeof ERROR_CODES)[ErrorCode] {
  return ERROR_CODES[code];
}
