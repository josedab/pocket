/**
 * Query operators and matching utilities for the Pocket query engine.
 *
 * This module provides the core filtering logic used by {@link QueryExecutor}
 * and {@link LiveQuery} to evaluate documents against query predicates.
 *
 * ## Supported Operators
 *
 * ### Comparison Operators
 * - `$eq` - Equality (also implicit when value is not an operator object)
 * - `$ne` - Not equal
 * - `$gt`, `$gte` - Greater than (or equal)
 * - `$lt`, `$lte` - Less than (or equal)
 * - `$in`, `$nin` - In array / not in array
 *
 * ### String Operators
 * - `$regex` - Regular expression match
 * - `$startsWith`, `$endsWith`, `$contains` - String pattern matching
 *
 * ### Array Operators
 * - `$all` - Array contains all elements
 * - `$size` - Array length equals
 * - `$elemMatch` - At least one element matches condition
 *
 * ### Logical Operators
 * - `$and`, `$or`, `$not`, `$nor` - Combine multiple conditions
 *
 * ## Security
 *
 * This module includes ReDoS (Regular Expression Denial of Service) protection
 * for user-provided regex patterns. See {@link createSafeRegex} for details.
 *
 * @module query/operators
 */

import type { Document } from '../types/document.js';
import type {
  ComparisonOperators,
  QueryCondition,
  QueryFilter,
  StringOperators,
} from '../types/query.js';

/**
 * Maximum allowed regex pattern length to prevent ReDoS attacks.
 * Patterns exceeding this length are rejected by {@link createSafeRegex}.
 */
const MAX_REGEX_PATTERN_LENGTH = 1000;

/**
 * Regex patterns that can cause catastrophic backtracking (ReDoS).
 *
 * These simplified checks detect common problematic patterns:
 * - Nested quantifiers like `(a+)+` or `(a*)*`
 * - Quantified groups with internal quantifiers
 *
 * @see https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
 */
const REDOS_PATTERNS = [
  /(\+|\*|\{[\d,]+\})\s*\1/, // Nested quantifiers like (a+)+
  /\(\?:[^)]*(\+|\*|\{[\d,]+\})[^)]*\)\s*(\+|\*|\{[\d,]+\})/, // Quantified groups
];

/**
 * Creates a RegExp safely, catching invalid patterns and checking for ReDoS vulnerabilities.
 *
 * This function implements defense-in-depth against Regular Expression Denial of Service:
 * 1. **Length limit** - Rejects patterns longer than 1000 characters
 * 2. **Pattern analysis** - Detects common catastrophic backtracking patterns
 * 3. **Error handling** - Catches invalid regex syntax
 *
 * @param pattern - The regex pattern string to compile
 * @param flags - Optional regex flags (e.g., 'i' for case-insensitive)
 * @returns A compiled RegExp instance, or `null` if the pattern is invalid or potentially dangerous
 *
 * @example
 * ```typescript
 * // Safe pattern - returns RegExp
 * createSafeRegex('^[a-z]+$', 'i');  // /^[a-z]+$/i
 *
 * // Dangerous pattern (nested quantifiers) - returns null
 * createSafeRegex('(a+)+$');  // null
 *
 * // Invalid syntax - returns null
 * createSafeRegex('[invalid');  // null
 * ```
 *
 * @internal
 */
function createSafeRegex(pattern: string, flags?: string): RegExp | null {
  // Check pattern length
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return null;
  }

  // Check for potential ReDoS patterns
  for (const redosPattern of REDOS_PATTERNS) {
    if (redosPattern.test(pattern)) {
      return null;
    }
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    // Invalid regex pattern
    return null;
  }
}

/**
 * Tests if a value matches a query condition.
 *
 * A condition can be either:
 * - A **direct value** for equality comparison (e.g., `'active'`, `42`, `null`)
 * - An **operator object** with one or more comparison operators
 *
 * All operators in a condition must match (implicit AND).
 *
 * @typeParam T - The type of the value being compared
 * @param value - The value to test (from the document)
 * @param condition - The condition to match against (from the query)
 * @returns `true` if the value satisfies all condition operators
 *
 * @example
 * ```typescript
 * // Direct equality
 * matchesCondition('active', 'active');  // true
 *
 * // Comparison operators
 * matchesCondition(25, { $gte: 18, $lt: 65 });  // true
 *
 * // String operators
 * matchesCondition('hello@example.com', {
 *   $endsWith: '@example.com'
 * });  // true
 *
 * // Array operators
 * matchesCondition(['admin', 'user'], {
 *   $all: ['admin']
 * });  // true
 * ```
 */
export function matchesCondition<T>(value: T, condition: QueryCondition<T>): boolean {
  // Direct equality check
  if (
    condition === null ||
    typeof condition !== 'object' ||
    condition instanceof RegExp ||
    condition instanceof Date
  ) {
    return isEqual(value, condition as T);
  }

  // Check if condition has operators
  const ops = condition as ComparisonOperators<T> & StringOperators;

  // $eq - equality
  if ('$eq' in ops) {
    if (!isEqual(value, ops.$eq as T)) return false;
  }

  // $ne - not equal
  if ('$ne' in ops) {
    if (isEqual(value, ops.$ne as T)) return false;
  }

  // $gt - greater than
  if ('$gt' in ops) {
    if (!isGreaterThan(value, ops.$gt as T)) return false;
  }

  // $gte - greater than or equal
  if ('$gte' in ops) {
    if (!isGreaterThanOrEqual(value, ops.$gte as T)) return false;
  }

  // $lt - less than
  if ('$lt' in ops) {
    if (!isLessThan(value, ops.$lt as T)) return false;
  }

  // $lte - less than or equal
  if ('$lte' in ops) {
    if (!isLessThanOrEqual(value, ops.$lte as T)) return false;
  }

  // $in - in array
  if ('$in' in ops) {
    if (!ops.$in?.some((v) => isEqual(value, v))) return false;
  }

  // $nin - not in array
  if ('$nin' in ops) {
    if (ops.$nin?.some((v) => isEqual(value, v))) return false;
  }

  // String operators
  if (typeof value === 'string') {
    // $regex - regular expression
    if ('$regex' in ops) {
      let regex: RegExp | null;
      if (ops.$regex instanceof RegExp) {
        regex = ops.$regex;
      } else {
        regex = createSafeRegex(ops.$regex!);
        if (regex === null) {
          // Invalid or potentially dangerous regex pattern - treat as no match
          return false;
        }
      }
      if (!regex.test(value)) return false;
    }

    // $startsWith
    if ('$startsWith' in ops) {
      if (!value.startsWith(ops.$startsWith!)) return false;
    }

    // $endsWith
    if ('$endsWith' in ops) {
      if (!value.endsWith(ops.$endsWith!)) return false;
    }

    // $contains
    if ('$contains' in ops) {
      if (!value.includes(ops.$contains!)) return false;
    }
  }

  // Array operators
  if (Array.isArray(value)) {
    // $all - contains all elements
    if ('$all' in ops && Array.isArray(ops.$all)) {
      if (!ops.$all.every((v) => value.some((item) => isEqual(item, v)))) return false;
    }

    // $size - array size
    if ('$size' in ops) {
      if (value.length !== ops.$size) return false;
    }

    // $elemMatch - at least one element matches
    if ('$elemMatch' in ops && ops.$elemMatch) {
      const elemCondition = ops.$elemMatch as QueryCondition<unknown>;
      if (!value.some((item) => matchesCondition(item, elemCondition))) return false;
    }
  }

  return true;
}

/**
 * Tests if a document matches a complete query filter.
 *
 * The filter can contain:
 * - **Field conditions**: Direct field-to-condition mappings
 * - **Logical operators**: `$and`, `$or`, `$not`, `$nor` for combining conditions
 * - **Nested paths**: Dot notation for nested object fields (e.g., `'address.city'`)
 *
 * @typeParam T - The document type, must extend {@link Document}
 * @param doc - The document to test
 * @param filter - The query filter containing field conditions and logical operators
 * @returns `true` if the document matches all filter conditions
 *
 * @example
 * ```typescript
 * const user = { _id: '1', name: 'John', age: 30, status: 'active' };
 *
 * // Simple field matching
 * matchesFilter(user, { status: 'active' });  // true
 *
 * // Multiple conditions (implicit AND)
 * matchesFilter(user, {
 *   status: 'active',
 *   age: { $gte: 18 }
 * });  // true
 *
 * // Logical operators
 * matchesFilter(user, {
 *   $or: [
 *     { status: 'active' },
 *     { status: 'pending' }
 *   ]
 * });  // true
 *
 * // Nested paths
 * const order = { _id: '1', customer: { name: 'John' } };
 * matchesFilter(order, { 'customer.name': 'John' });  // true
 * ```
 */
export function matchesFilter<T extends Document>(doc: T, filter: QueryFilter<T>): boolean {
  // Handle logical operators
  if ('$and' in filter && filter.$and) {
    if (!filter.$and.every((f) => matchesFilter(doc, f))) return false;
  }

  if ('$or' in filter && filter.$or) {
    if (!filter.$or.some((f) => matchesFilter(doc, f))) return false;
  }

  if ('$not' in filter && filter.$not) {
    if (matchesFilter(doc, filter.$not)) return false;
  }

  if ('$nor' in filter && filter.$nor) {
    if (filter.$nor.some((f) => matchesFilter(doc, f))) return false;
  }

  // Check each field condition
  for (const [key, condition] of Object.entries(filter)) {
    // Skip logical operators
    if (key.startsWith('$')) continue;

    const value = getNestedValue(doc, key);
    if (!matchesCondition(value, condition)) {
      return false;
    }
  }

  return true;
}

/**
 * Retrieves a nested value from an object using dot notation path.
 *
 * Safely traverses the object tree, returning `undefined` if any
 * intermediate value is `null` or `undefined`.
 *
 * @param obj - The object to traverse
 * @param path - Dot-notation path (e.g., `'user.address.city'`)
 * @returns The value at the path, or `undefined` if not found
 *
 * @example
 * ```typescript
 * const doc = {
 *   user: {
 *     profile: {
 *       name: 'John'
 *     }
 *   }
 * };
 *
 * getNestedValue(doc, 'user.profile.name');  // 'John'
 * getNestedValue(doc, 'user.profile.age');   // undefined
 * getNestedValue(doc, 'user.missing.name');  // undefined
 * ```
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
 * Sets a nested value in an object using dot notation path.
 *
 * Creates intermediate objects as needed if the path doesn't exist.
 * Mutates the original object.
 *
 * @param obj - The object to modify (mutated in place)
 * @param path - Dot-notation path (e.g., `'user.address.city'`)
 * @param value - The value to set at the path
 *
 * @example
 * ```typescript
 * const doc = { user: {} };
 *
 * setNestedValue(doc, 'user.profile.name', 'John');
 * // doc is now: { user: { profile: { name: 'John' } } }
 *
 * setNestedValue(doc, 'user.profile.age', 30);
 * // doc is now: { user: { profile: { name: 'John', age: 30 } } }
 * ```
 */
export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    current[lastPart] = value;
  }
}

/**
 * Performs a deep equality check between two values.
 *
 * Handles special cases:
 * - **Primitives**: Strict equality (`===`)
 * - **null**: Special case comparison
 * - **Date**: Compares timestamps
 * - **RegExp**: Compares string representations
 * - **Array**: Recursive element comparison (order matters)
 * - **Object**: Recursive property comparison (same keys required)
 *
 * @typeParam T - The type of values being compared
 * @param a - First value
 * @param b - Second value
 * @returns `true` if values are deeply equal
 *
 * @example
 * ```typescript
 * isEqual(1, 1);                    // true
 * isEqual({ a: 1 }, { a: 1 });      // true
 * isEqual([1, 2], [1, 2]);          // true
 * isEqual(new Date(0), new Date(0)); // true
 *
 * isEqual({ a: 1 }, { a: 2 });      // false
 * isEqual([1, 2], [2, 1]);          // false (order matters)
 * ```
 */
export function isEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
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
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }

  return false;
}

/**
 * Checks if value `a` is greater than value `b`.
 *
 * Supports comparison of:
 * - **Numbers**: Numeric comparison
 * - **Strings**: Lexicographic comparison
 * - **Dates**: Timestamp comparison
 *
 * @typeParam T - The type of values being compared
 * @param a - First value
 * @param b - Second value
 * @returns `true` if `a > b`, `false` otherwise (including type mismatches)
 */
export function isGreaterThan<T>(a: T, b: T): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a > b;
  if (typeof a === 'string' && typeof b === 'string') return a > b;
  if (a instanceof Date && b instanceof Date) return a.getTime() > b.getTime();
  return false;
}

/**
 * Checks if value `a` is greater than or equal to value `b`.
 *
 * @typeParam T - The type of values being compared
 * @param a - First value
 * @param b - Second value
 * @returns `true` if `a >= b`
 */
export function isGreaterThanOrEqual<T>(a: T, b: T): boolean {
  return isEqual(a, b) || isGreaterThan(a, b);
}

/**
 * Checks if value `a` is less than value `b`.
 *
 * Supports comparison of:
 * - **Numbers**: Numeric comparison
 * - **Strings**: Lexicographic comparison
 * - **Dates**: Timestamp comparison
 *
 * @typeParam T - The type of values being compared
 * @param a - First value
 * @param b - Second value
 * @returns `true` if `a < b`, `false` otherwise (including type mismatches)
 */
export function isLessThan<T>(a: T, b: T): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return a < b;
  if (a instanceof Date && b instanceof Date) return a.getTime() < b.getTime();
  return false;
}

/**
 * Checks if value `a` is less than or equal to value `b`.
 *
 * @typeParam T - The type of values being compared
 * @param a - First value
 * @param b - Second value
 * @returns `true` if `a <= b`
 */
export function isLessThanOrEqual<T>(a: T, b: T): boolean {
  return isEqual(a, b) || isLessThan(a, b);
}

/**
 * Compares two values for sorting, with configurable direction.
 *
 * Used by {@link QueryExecutor} to implement multi-field sorting.
 *
 * Comparison rules:
 * - **null/undefined**: Always sorted last (regardless of direction)
 * - **Numbers**: Numeric difference
 * - **Strings**: Locale-aware comparison
 * - **Dates**: Timestamp difference
 * - **Booleans**: `false` before `true`
 * - **Other types**: Treated as equal (returns 0)
 *
 * @typeParam T - The type of values being compared
 * @param a - First value
 * @param b - Second value
 * @param direction - Sort direction: `'asc'` (default) or `'desc'`
 * @returns Negative if `a < b`, positive if `a > b`, zero if equal
 *
 * @example
 * ```typescript
 * // Ascending (default)
 * compareValues(1, 2);           // -1
 * compareValues('apple', 'banana'); // -1
 *
 * // Descending
 * compareValues(1, 2, 'desc');   // 1
 *
 * // Nulls sort last
 * compareValues(null, 1);        // 1 (null after 1 in asc)
 * compareValues(null, 1, 'desc'); // -1 (null after 1 in desc)
 * ```
 */
export function compareValues<T>(a: T, b: T, direction: 'asc' | 'desc' = 'asc'): number {
  const multiplier = direction === 'asc' ? 1 : -1;

  if (a === b) return 0;
  if (a === null || a === undefined) return 1 * multiplier;
  if (b === null || b === undefined) return -1 * multiplier;

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * multiplier;
  }

  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b) * multiplier;
  }

  if (a instanceof Date && b instanceof Date) {
    return (a.getTime() - b.getTime()) * multiplier;
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a === b ? 0 : a ? 1 : -1) * multiplier;
  }

  return 0;
}
