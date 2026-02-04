/**
 * Filter evaluator for materialized views.
 *
 * Provides a standalone filter evaluation engine that determines whether a
 * document matches a given filter specification. This is used by
 * {@link MaterializedView} to decide whether a changed document should
 * enter or leave a view.
 *
 * Supports the same operator set as the core query engine:
 * - Comparison: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
 * - Logical: $and, $or, $not
 * - Existence: $exists
 * - Pattern: $regex
 * - Nested field access via dot notation
 *
 * @module filter-evaluator
 */

/**
 * Maximum allowed regex pattern length to prevent ReDoS attacks.
 */
const MAX_REGEX_PATTERN_LENGTH = 1000;

/**
 * Regex patterns that can cause catastrophic backtracking (ReDoS).
 */
const REDOS_PATTERNS = [
  /(\+|\*|\{[\d,]+\})\s*\1/,
  /\(\?:[^)]*(\+|\*|\{[\d,]+\})[^)]*\)\s*(\+|\*|\{[\d,]+\})/,
];

/**
 * Creates a RegExp safely, catching invalid patterns and checking for ReDoS.
 */
function createSafeRegex(pattern: string, flags?: string): RegExp | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return null;
  }

  for (const redosPattern of REDOS_PATTERNS) {
    if (redosPattern.test(pattern)) {
      return null;
    }
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Retrieves a nested value from an object using dot notation.
 *
 * @param obj - The object to traverse
 * @param path - Dot-separated field path (e.g., 'user.address.city')
 * @returns The value at the path, or undefined if any segment is missing
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluates whether a document matches a filter specification.
 *
 * The filter is a record of field names (or operators) to conditions.
 * Field names starting with '$' are treated as logical operators.
 * All other keys are treated as field-level conditions.
 *
 * An empty filter or undefined filter matches all documents.
 *
 * @param doc - The document to evaluate
 * @param filter - The filter specification
 * @returns true if the document matches, false otherwise
 *
 * @example
 * ```typescript
 * const filter = { status: 'active', age: { $gte: 18 } };
 * evaluateFilter({ _id: '1', status: 'active', age: 25 }, filter); // true
 * evaluateFilter({ _id: '2', status: 'inactive', age: 25 }, filter); // false
 * ```
 */
export function evaluateFilter(
  doc: unknown,
  filter: Record<string, unknown> | undefined
): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  // Handle logical operators
  if ('$and' in filter && Array.isArray(filter.$and)) {
    const conditions = filter.$and as Record<string, unknown>[];
    if (!conditions.every((f) => evaluateFilter(doc, f))) {
      return false;
    }
  }

  if ('$or' in filter && Array.isArray(filter.$or)) {
    const conditions = filter.$or as Record<string, unknown>[];
    if (!conditions.some((f) => evaluateFilter(doc, f))) {
      return false;
    }
  }

  if ('$not' in filter && filter.$not !== undefined) {
    const condition = filter.$not as Record<string, unknown>;
    if (evaluateFilter(doc, condition)) {
      return false;
    }
  }

  // Check each field condition
  for (const [key, condition] of Object.entries(filter)) {
    if (key.startsWith('$')) continue;

    const value = getNestedValue(doc, key);
    if (!evaluateCondition(value, condition)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates a single field condition against a value.
 *
 * If the condition is a primitive (string, number, boolean, null), it performs
 * direct equality. If the condition is an object with operator keys ($eq, $gt, etc.),
 * each operator is evaluated and all must pass (implicit AND).
 *
 * @param value - The document field value
 * @param condition - The condition to evaluate (primitive or operator object)
 * @returns true if the value satisfies the condition
 */
function evaluateCondition(value: unknown, condition: unknown): boolean {
  // Null/undefined condition means equality check against null/undefined
  if (condition === null || condition === undefined) {
    return value === condition;
  }

  // Primitive condition: direct equality
  if (typeof condition !== 'object' || condition instanceof RegExp || condition instanceof Date) {
    return isEqual(value, condition);
  }

  // Array condition: direct equality
  if (Array.isArray(condition)) {
    return isEqual(value, condition);
  }

  // Object condition: check for operators
  const ops = condition as Record<string, unknown>;
  const hasOperators = Object.keys(ops).some((k) => k.startsWith('$'));

  if (!hasOperators) {
    // Plain object equality
    return isEqual(value, condition);
  }

  // Evaluate each operator
  if ('$eq' in ops) {
    if (!isEqual(value, ops.$eq)) return false;
  }

  if ('$ne' in ops) {
    if (isEqual(value, ops.$ne)) return false;
  }

  if ('$gt' in ops) {
    if (!isGreaterThan(value, ops.$gt)) return false;
  }

  if ('$gte' in ops) {
    if (!isGreaterThanOrEqual(value, ops.$gte)) return false;
  }

  if ('$lt' in ops) {
    if (!isLessThan(value, ops.$lt)) return false;
  }

  if ('$lte' in ops) {
    if (!isLessThanOrEqual(value, ops.$lte)) return false;
  }

  if ('$in' in ops) {
    const arr = ops.$in;
    if (!Array.isArray(arr)) return false;
    if (!arr.some((v) => isEqual(value, v))) return false;
  }

  if ('$nin' in ops) {
    const arr = ops.$nin;
    if (!Array.isArray(arr)) return false;
    if (arr.some((v) => isEqual(value, v))) return false;
  }

  if ('$exists' in ops) {
    const shouldExist = ops.$exists as boolean;
    const doesExist = value !== undefined && value !== null;
    if (shouldExist !== doesExist) return false;
  }

  if ('$regex' in ops) {
    if (typeof value !== 'string') return false;
    const regexVal = ops.$regex;
    let regex: RegExp | null;
    if (regexVal instanceof RegExp) {
      regex = regexVal;
    } else if (typeof regexVal === 'string') {
      regex = createSafeRegex(regexVal);
      if (regex === null) return false;
    } else {
      return false;
    }
    if (!regex.test(value)) return false;
  }

  return true;
}

/**
 * Deep equality comparison between two values.
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (a instanceof RegExp && b instanceof RegExp) {
    return a.toString() === b.toString();
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      isEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }

  return false;
}

/**
 * Checks if value a is strictly greater than value b.
 */
function isGreaterThan(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a > b;
  if (typeof a === 'string' && typeof b === 'string') return a > b;
  if (a instanceof Date && b instanceof Date) return a.getTime() > b.getTime();
  return false;
}

/**
 * Checks if value a is greater than or equal to value b.
 */
function isGreaterThanOrEqual(a: unknown, b: unknown): boolean {
  return isEqual(a, b) || isGreaterThan(a, b);
}

/**
 * Checks if value a is strictly less than value b.
 */
function isLessThan(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return a < b;
  if (a instanceof Date && b instanceof Date) return a.getTime() < b.getTime();
  return false;
}

/**
 * Checks if value a is less than or equal to value b.
 */
function isLessThanOrEqual(a: unknown, b: unknown): boolean {
  return isEqual(a, b) || isLessThan(a, b);
}
