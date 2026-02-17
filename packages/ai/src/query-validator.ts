/**
 * Query validation layer for the AI copilot.
 *
 * Validates generated queries against collection schemas before execution,
 * checking field existence, operator compatibility, type correctness,
 * and structural validity.
 *
 * @module query-validator
 */

import type { CollectionSchema, SchemaField } from './smart-query.js';

/** Validation severity */
export type QueryValidationSeverity = 'error' | 'warning' | 'info';

/** A single validation issue */
export interface QueryValidationIssue {
  readonly severity: QueryValidationSeverity;
  readonly field?: string;
  readonly operator?: string;
  readonly message: string;
  readonly suggestion?: string;
}

/** Full validation result */
export interface QueryValidationResult {
  readonly valid: boolean;
  readonly issues: readonly QueryValidationIssue[];
  readonly validatedCollection: string;
  readonly fieldsCovered: readonly string[];
}

/** Query to validate */
export interface QueryToValidate {
  readonly collection: string;
  readonly filter?: Record<string, unknown>;
  readonly sort?: Record<string, 'asc' | 'desc'>;
  readonly limit?: number;
  readonly skip?: number;
}

const VALID_OPERATORS = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '$in', '$nin', '$regex', '$startsWith', '$endsWith', '$contains',
  '$exists', '$and', '$or', '$not', '$all', '$elemMatch', '$size',
]);

const OPERATOR_TYPE_COMPAT: Record<string, Set<string>> = {
  '$gt': new Set(['number', 'date']),
  '$gte': new Set(['number', 'date']),
  '$lt': new Set(['number', 'date']),
  '$lte': new Set(['number', 'date']),
  '$regex': new Set(['string']),
  '$startsWith': new Set(['string']),
  '$endsWith': new Set(['string']),
  '$contains': new Set(['string']),
  '$size': new Set(['array']),
  '$elemMatch': new Set(['array']),
  '$all': new Set(['array']),
};

/**
 * Validates a generated query against a collection schema.
 *
 * @example
 * ```typescript
 * import { validateQuery } from '@pocket/ai';
 *
 * const result = validateQuery(
 *   { collection: 'todos', filter: { nonexistent: true } },
 *   schemas,
 * );
 * if (!result.valid) {
 *   console.log(result.issues); // [{ message: "Unknown field 'nonexistent'" }]
 * }
 * ```
 */
export function validateQuery(
  query: QueryToValidate,
  schemas: readonly CollectionSchema[],
): QueryValidationResult {
  const issues: QueryValidationIssue[] = [];
  const fieldsCovered: string[] = [];

  // Find the collection schema
  const schema = schemas.find((s) => s.name === query.collection);
  if (!schema) {
    issues.push({
      severity: 'error',
      message: `Unknown collection "${query.collection}"`,
      suggestion: `Available collections: ${schemas.map((s) => s.name).join(', ')}`,
    });
    return { valid: false, issues, validatedCollection: query.collection, fieldsCovered };
  }

  const fieldMap = new Map<string, SchemaField>(
    schema.fields.map((f) => [f.name, f]),
  );

  // Validate filter fields
  if (query.filter) {
    validateFilter(query.filter, fieldMap, issues, fieldsCovered);
  }

  // Validate sort fields
  if (query.sort) {
    for (const field of Object.keys(query.sort)) {
      if (!fieldMap.has(field) && field !== '_id' && field !== '_createdAt' && field !== '_updatedAt') {
        issues.push({
          severity: 'warning',
          field,
          message: `Sort field "${field}" not found in schema`,
          suggestion: `Available fields: ${Array.from(fieldMap.keys()).join(', ')}`,
        });
      } else {
        fieldsCovered.push(field);
      }
    }
  }

  // Validate pagination
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'number' || query.limit < 0) {
      issues.push({ severity: 'error', message: 'Limit must be a non-negative number' });
    } else if (query.limit > 10_000) {
      issues.push({ severity: 'warning', message: 'Limit exceeds 10,000 — consider pagination' });
    }
  }

  if (query.skip !== undefined && (typeof query.skip !== 'number' || query.skip < 0)) {
    issues.push({ severity: 'error', message: 'Skip must be a non-negative number' });
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return {
    valid: !hasErrors,
    issues,
    validatedCollection: query.collection,
    fieldsCovered: [...new Set(fieldsCovered)],
  };
}

function validateFilter(
  filter: Record<string, unknown>,
  fieldMap: Map<string, SchemaField>,
  issues: QueryValidationIssue[],
  fieldsCovered: string[],
): void {
  for (const [key, value] of Object.entries(filter)) {
    // Logical operators
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) {
        issues.push({ severity: 'error', operator: key, message: `${key} must be an array` });
      } else {
        for (const sub of value) {
          if (typeof sub === 'object' && sub !== null) {
            validateFilter(sub as Record<string, unknown>, fieldMap, issues, fieldsCovered);
          }
        }
      }
      continue;
    }

    // Skip system fields
    if (key === '_id' || key === '_createdAt' || key === '_updatedAt') {
      fieldsCovered.push(key);
      continue;
    }

    // Check field existence
    const fieldSchema = fieldMap.get(key);
    if (!fieldSchema) {
      issues.push({
        severity: 'warning',
        field: key,
        message: `Field "${key}" not found in schema`,
        suggestion: `Available fields: ${Array.from(fieldMap.keys()).join(', ')}`,
      });
      continue;
    }

    fieldsCovered.push(key);

    // Check operator usage
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [op] of Object.entries(value as Record<string, unknown>)) {
        if (!VALID_OPERATORS.has(op)) {
          issues.push({
            severity: 'error',
            field: key,
            operator: op,
            message: `Unknown operator "${op}" on field "${key}"`,
          });
          continue;
        }

        // Check type compatibility
        const compat = OPERATOR_TYPE_COMPAT[op];
        if (compat && !compat.has(fieldSchema.type)) {
          issues.push({
            severity: 'warning',
            field: key,
            operator: op,
            message: `Operator "${op}" may not be compatible with field type "${fieldSchema.type}"`,
          });
        }
      }
    }
  }
}

/**
 * Validate a query and return a summary string for quick checks.
 */
export function quickValidateQuery(
  query: QueryToValidate,
  schemas: readonly CollectionSchema[],
): string {
  const result = validateQuery(query, schemas);
  if (result.valid && result.issues.length === 0) return 'OK';
  if (result.valid) return `OK with ${result.issues.length} warning(s)`;
  const errors = result.issues.filter((i) => i.severity === 'error');
  return `INVALID: ${errors.map((e) => e.message).join('; ')}`;
}
