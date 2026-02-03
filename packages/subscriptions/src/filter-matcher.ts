/**
 * FilterMatcher - evaluates Pocket filter operators against documents
 *
 * Used server-side to determine whether a document change affects a subscription's
 * result set. Supports all standard Pocket query filter operators.
 */

/**
 * Get a nested value from an object using a dot-separated path
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a value is a filter operator object (has keys starting with $)
 */
function isOperatorObject(value: unknown): value is Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length > 0 && keys.some((k) => k.startsWith('$'));
}

/**
 * Compare two values for ordering (gt, gte, lt, lte)
 * Returns negative if a < b, 0 if equal, positive if a > b
 */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b);
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime();
  }
  // Fallback: convert to string
  return String(a).localeCompare(String(b));
}

/**
 * FilterMatcher evaluates Pocket filter operators against a document.
 *
 * Supported operators:
 * - $eq, $ne: equality / inequality
 * - $gt, $gte, $lt, $lte: comparison
 * - $in, $nin: set membership
 * - $exists: field existence
 * - $and, $or, $not: logical combinators
 */
export class FilterMatcher {
  /**
   * Test whether a document matches the given filter
   *
   * @param doc - The document to test
   * @param filter - The filter to evaluate
   * @returns true if the document matches all filter conditions
   */
  matches(doc: unknown, filter: Record<string, unknown>): boolean {
    if (!filter || Object.keys(filter).length === 0) {
      return true;
    }

    for (const [key, condition] of Object.entries(filter)) {
      // Handle logical operators at the top level
      if (key === '$and') {
        if (!this.evalAnd(doc, condition as Record<string, unknown>[])) {
          return false;
        }
        continue;
      }

      if (key === '$or') {
        if (!this.evalOr(doc, condition as Record<string, unknown>[])) {
          return false;
        }
        continue;
      }

      if (key === '$not') {
        if (!this.evalNot(doc, condition as Record<string, unknown>)) {
          return false;
        }
        continue;
      }

      // Field-level condition
      const fieldValue = getNestedValue(doc, key);

      if (isOperatorObject(condition)) {
        if (!this.evalOperators(fieldValue, condition)) {
          return false;
        }
      } else {
        // Implicit $eq
        if (!this.evalEq(fieldValue, condition)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Evaluate operator conditions against a field value
   */
  private evalOperators(fieldValue: unknown, operators: Record<string, unknown>): boolean {
    for (const [op, operand] of Object.entries(operators)) {
      switch (op) {
        case '$eq':
          if (!this.evalEq(fieldValue, operand)) return false;
          break;

        case '$ne':
          if (this.evalEq(fieldValue, operand)) return false;
          break;

        case '$gt':
          if (compareValues(fieldValue, operand) <= 0) return false;
          break;

        case '$gte':
          if (compareValues(fieldValue, operand) < 0) return false;
          break;

        case '$lt':
          if (compareValues(fieldValue, operand) >= 0) return false;
          break;

        case '$lte':
          if (compareValues(fieldValue, operand) > 0) return false;
          break;

        case '$in':
          if (!this.evalIn(fieldValue, operand as unknown[])) return false;
          break;

        case '$nin':
          if (this.evalIn(fieldValue, operand as unknown[])) return false;
          break;

        case '$exists': {
          const exists = fieldValue !== undefined;
          if (operand && !exists) return false;
          if (!operand && exists) return false;
          break;
        }

        default:
          // Unknown operator - skip (lenient mode)
          break;
      }
    }

    return true;
  }

  /**
   * Evaluate $eq (deep equality for primitives, reference for objects)
   */
  private evalEq(fieldValue: unknown, expected: unknown): boolean {
    if (fieldValue === expected) return true;

    // Handle null/undefined equivalence
    if (fieldValue === null && expected === null) return true;
    if (fieldValue === undefined && expected === undefined) return true;

    // Handle date comparison
    if (fieldValue instanceof Date && expected instanceof Date) {
      return fieldValue.getTime() === expected.getTime();
    }

    // Handle array comparison
    if (Array.isArray(fieldValue) && Array.isArray(expected)) {
      if (fieldValue.length !== expected.length) return false;
      return fieldValue.every((v, i) => this.evalEq(v, expected[i]));
    }

    return false;
  }

  /**
   * Evaluate $in (value is in array)
   */
  private evalIn(fieldValue: unknown, values: unknown[]): boolean {
    if (!Array.isArray(values)) return false;
    return values.some((v) => this.evalEq(fieldValue, v));
  }

  /**
   * Evaluate $and (all conditions must match)
   */
  private evalAnd(doc: unknown, conditions: Record<string, unknown>[]): boolean {
    if (!Array.isArray(conditions)) return false;
    return conditions.every((condition) => this.matches(doc, condition));
  }

  /**
   * Evaluate $or (at least one condition must match)
   */
  private evalOr(doc: unknown, conditions: Record<string, unknown>[]): boolean {
    if (!Array.isArray(conditions)) return false;
    return conditions.some((condition) => this.matches(doc, condition));
  }

  /**
   * Evaluate $not (condition must NOT match)
   */
  private evalNot(doc: unknown, condition: Record<string, unknown>): boolean {
    return !this.matches(doc, condition);
  }
}

/**
 * Create a new FilterMatcher instance
 */
export function createFilterMatcher(): FilterMatcher {
  return new FilterMatcher();
}
