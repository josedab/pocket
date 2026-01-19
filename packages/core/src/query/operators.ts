import type { Document } from '../types/document.js';
import type {
  ComparisonOperators,
  QueryCondition,
  QueryFilter,
  StringOperators,
} from '../types/query.js';

/**
 * Maximum allowed regex pattern length to prevent ReDoS attacks
 */
const MAX_REGEX_PATTERN_LENGTH = 1000;

/**
 * Patterns that can cause catastrophic backtracking (ReDoS)
 * These are simplified checks for common problematic patterns
 */
const REDOS_PATTERNS = [
  /(\+|\*|\{[\d,]+\})\s*\1/, // Nested quantifiers like (a+)+
  /\(\?:[^)]*(\+|\*|\{[\d,]+\})[^)]*\)\s*(\+|\*|\{[\d,]+\})/, // Quantified groups
];

/**
 * Create a safe RegExp, catching invalid patterns and checking for ReDoS vulnerabilities
 * @param pattern - The regex pattern string
 * @param flags - Optional regex flags
 * @returns RegExp instance or null if pattern is invalid/dangerous
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
 * Check if a value matches a condition
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
        regex = createSafeRegex(ops.$regex as string);
        if (regex === null) {
          // Invalid or potentially dangerous regex pattern - treat as no match
          return false;
        }
      }
      if (!regex.test(value)) return false;
    }

    // $startsWith
    if ('$startsWith' in ops) {
      if (!value.startsWith(ops.$startsWith as string)) return false;
    }

    // $endsWith
    if ('$endsWith' in ops) {
      if (!value.endsWith(ops.$endsWith as string)) return false;
    }

    // $contains
    if ('$contains' in ops) {
      if (!value.includes(ops.$contains as string)) return false;
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
 * Check if a document matches a filter
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
    if (!matchesCondition(value, condition as QueryCondition<unknown>)) {
      return false;
    }
  }

  return true;
}

/**
 * Get a nested value from an object using dot notation
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
 * Set a nested value in an object using dot notation
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
 * Deep equality check
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
 * Comparison helpers
 */
export function isGreaterThan<T>(a: T, b: T): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a > b;
  if (typeof a === 'string' && typeof b === 'string') return a > b;
  if (a instanceof Date && b instanceof Date) return a.getTime() > b.getTime();
  return false;
}

export function isGreaterThanOrEqual<T>(a: T, b: T): boolean {
  return isEqual(a, b) || isGreaterThan(a, b);
}

export function isLessThan<T>(a: T, b: T): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return a < b;
  if (a instanceof Date && b instanceof Date) return a.getTime() < b.getTime();
  return false;
}

export function isLessThanOrEqual<T>(a: T, b: T): boolean {
  return isEqual(a, b) || isLessThan(a, b);
}

/**
 * Compare two values for sorting
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
