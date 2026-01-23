/**
 * Query Executor - Executes queries against data
 */

import type {
  AggregationSpec,
  Condition,
  FieldCondition,
  LogicalCondition,
  QueryDefinition,
  QueryOptions,
  QueryResult,
  SortSpec,
} from './types.js';

/**
 * Type guard for field condition
 */
function isFieldCondition(condition: Condition): condition is FieldCondition {
  return 'field' in condition && 'value' in condition;
}

/**
 * Type guard for logical condition
 */
function isLogicalCondition(condition: Condition): condition is LogicalCondition {
  return 'operator' in condition && 'conditions' in condition;
}

/**
 * Get nested field value from object
 */
function getFieldValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let value: unknown = obj;

  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

/**
 * Evaluate a field condition against a document
 */
function evaluateFieldCondition(condition: FieldCondition, doc: Record<string, unknown>): boolean {
  const fieldValue = getFieldValue(doc, condition.field);
  const compareValue = condition.value;

  switch (condition.operator) {
    case 'eq':
      return fieldValue === compareValue;

    case 'neq':
      return fieldValue !== compareValue;

    case 'gt':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) > String(compareValue);
      }
      return fieldValue > compareValue;

    case 'gte':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) >= String(compareValue);
      }
      return fieldValue >= compareValue;

    case 'lt':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) < String(compareValue);
      }
      return fieldValue < compareValue;

    case 'lte':
      if (typeof fieldValue !== 'number' || typeof compareValue !== 'number') {
        return String(fieldValue) <= String(compareValue);
      }
      return fieldValue <= compareValue;

    case 'in':
      if (!Array.isArray(compareValue)) return false;
      return compareValue.includes(fieldValue);

    case 'nin':
      if (!Array.isArray(compareValue)) return false;
      return !compareValue.includes(fieldValue);

    case 'contains':
      if (typeof fieldValue !== 'string' || typeof compareValue !== 'string') {
        return false;
      }
      return fieldValue.toLowerCase().includes(compareValue.toLowerCase());

    case 'startsWith':
      if (typeof fieldValue !== 'string' || typeof compareValue !== 'string') {
        return false;
      }
      return fieldValue.toLowerCase().startsWith(compareValue.toLowerCase());

    case 'endsWith':
      if (typeof fieldValue !== 'string' || typeof compareValue !== 'string') {
        return false;
      }
      return fieldValue.toLowerCase().endsWith(compareValue.toLowerCase());

    case 'regex':
      if (typeof fieldValue !== 'string' || typeof compareValue !== 'string') {
        return false;
      }
      try {
        const regex = new RegExp(compareValue, 'i');
        return regex.test(fieldValue);
      } catch {
        return false;
      }

    case 'exists': {
      const exists = fieldValue !== undefined && fieldValue !== null;
      return compareValue ? exists : !exists;
    }

    case 'type':
      return typeof fieldValue === compareValue;

    case 'between': {
      if (!Array.isArray(compareValue) || compareValue.length !== 2) {
        return false;
      }
      const [min, max] = compareValue;
      if (typeof fieldValue === 'number') {
        return fieldValue >= (min as number) && fieldValue <= (max as number);
      }
      const strValue = String(fieldValue);
      return strValue >= String(min) && strValue <= String(max);
    }

    default:
      return false;
  }
}

/**
 * Evaluate a condition against a document
 */
function evaluateCondition(condition: Condition, doc: Record<string, unknown>): boolean {
  if (isFieldCondition(condition)) {
    return evaluateFieldCondition(condition, doc);
  }

  if (isLogicalCondition(condition)) {
    switch (condition.operator) {
      case 'and':
        return condition.conditions.every((c) => evaluateCondition(c, doc));
      case 'or':
        return condition.conditions.some((c) => evaluateCondition(c, doc));
      case 'not':
        return !condition.conditions.some((c) => evaluateCondition(c, doc));
      default:
        return false;
    }
  }

  return false;
}

/**
 * Compare values for sorting
 */
function compareValues(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  const multiplier = direction === 'asc' ? 1 : -1;

  if (a === b) return 0;
  if (a === null || a === undefined) return multiplier;
  if (b === null || b === undefined) return -multiplier;

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * multiplier;
  }

  if (a instanceof Date && b instanceof Date) {
    return (a.getTime() - b.getTime()) * multiplier;
  }

  // Convert to string, handling objects specially
  const aStr =
    typeof a === 'object' && a !== null
      ? JSON.stringify(a)
      : String(a as string | number | boolean);
  const bStr =
    typeof b === 'object' && b !== null
      ? JSON.stringify(b)
      : String(b as string | number | boolean);
  return aStr.localeCompare(bStr) * multiplier;
}

/**
 * Sort documents
 */
function sortDocuments<T extends Record<string, unknown>>(docs: T[], sortSpecs: SortSpec[]): T[] {
  return [...docs].sort((a, b) => {
    for (const spec of sortSpecs) {
      const aValue = getFieldValue(a, spec.field);
      const bValue = getFieldValue(b, spec.field);
      const comparison = compareValues(aValue, bValue, spec.direction);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

/**
 * Apply projection to documents
 */
function projectDocument<T extends Record<string, unknown>>(
  doc: T,
  include?: string[],
  exclude?: string[]
): T {
  if (include && include.length > 0) {
    const result: Record<string, unknown> = {};
    for (const field of include) {
      const value = getFieldValue(doc, field);
      if (value !== undefined) {
        setFieldValue(result, field, value);
      }
    }
    return result as T;
  }

  if (exclude && exclude.length > 0) {
    const result = { ...doc };
    for (const field of exclude) {
      deleteFieldValue(result, field);
    }
    return result;
  }

  return doc;
}

/**
 * Set a nested field value
 */
function setFieldValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]!] = value;
}

/**
 * Delete a nested field value
 */
function deleteFieldValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current)) return;
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    Reflect.deleteProperty(current, lastPart);
  }
}

/**
 * Calculate aggregations
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function calculateAggregations<T extends Record<string, unknown>>(
  docs: T[],
  specs: AggregationSpec[]
): Record<string, unknown> {
  const results: Record<string, unknown> = {};

  for (const spec of specs) {
    const alias = spec.alias ?? spec.type;

    switch (spec.type) {
      case 'count':
        results[alias] = docs.length;
        break;

      case 'sum':
        if (spec.field) {
          results[alias] = docs.reduce((sum, doc) => {
            const value = getFieldValue(doc, spec.field!);
            return sum + (typeof value === 'number' ? value : 0);
          }, 0);
        }
        break;

      case 'avg':
        if (spec.field) {
          const values = docs
            .map((doc) => getFieldValue(doc, spec.field!))
            .filter((v): v is number => typeof v === 'number');
          results[alias] =
            values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
        }
        break;

      case 'min':
        if (spec.field) {
          const values = docs
            .map((doc) => getFieldValue(doc, spec.field!))
            .filter((v) => v !== null && v !== undefined);
          results[alias] =
            values.length > 0 ? values.reduce((min, v) => (v < min ? v : min)) : null;
        }
        break;

      case 'max':
        if (spec.field) {
          const values = docs
            .map((doc) => getFieldValue(doc, spec.field!))
            .filter((v) => v !== null && v !== undefined);
          results[alias] =
            values.length > 0 ? values.reduce((max, v) => (v > max ? v : max)) : null;
        }
        break;

      case 'distinct':
        if (spec.field) {
          const values = new Set(docs.map((doc) => getFieldValue(doc, spec.field!)));
          results[alias] = Array.from(values);
        }
        break;

      case 'group':
        if (spec.groupBy && spec.groupBy.length > 0) {
          const groups = new Map<string, T[]>();
          for (const doc of docs) {
            const key = spec.groupBy.map((f) => String(getFieldValue(doc, f))).join('|');
            if (!groups.has(key)) {
              groups.set(key, []);
            }
            groups.get(key)!.push(doc);
          }
          results[alias] = Array.from(groups.entries()).map(([key, groupDocs]) => ({
            key,
            values: spec.groupBy!.reduce<Record<string, unknown>>((acc, field, i) => {
              acc[field] = key.split('|')[i];
              return acc;
            }, {}),
            count: groupDocs.length,
            documents: groupDocs,
          }));
        }
        break;
    }
  }

  return results;
}

/**
 * Execute a query against a dataset
 */
export function executeQuery<T extends Record<string, unknown>>(
  query: QueryDefinition,
  data: T[],
  _options: QueryOptions = {}
): QueryResult<T> {
  const startTime = Date.now();

  // Filter
  let filtered = data;
  if (query.where) {
    filtered = data.filter((doc) => evaluateCondition(query.where!, doc));
  }

  // Calculate aggregations before pagination
  let aggregations: Record<string, unknown> | undefined;
  if (query.aggregate && query.aggregate.length > 0) {
    aggregations = calculateAggregations(filtered, query.aggregate);
  }

  // Sort
  let sorted = filtered;
  if (query.orderBy && query.orderBy.length > 0) {
    sorted = sortDocuments(filtered, query.orderBy);
  }

  // Calculate total before pagination
  const total = sorted.length;

  // Paginate
  let paginated = sorted;
  if (query.pagination) {
    const { offset = 0, limit } = query.pagination;
    if (limit !== undefined) {
      paginated = sorted.slice(offset, offset + limit);
    } else if (offset > 0) {
      paginated = sorted.slice(offset);
    }
  }

  // Project
  let projected = paginated;
  if (query.select) {
    projected = paginated.map((doc) =>
      projectDocument(doc, query.select?.include, query.select?.exclude)
    );
  }

  // Determine cursor and hasMore
  let cursor: string | undefined;
  let hasMore = false;
  if (query.pagination?.limit) {
    const offset = query.pagination.offset ?? 0;
    hasMore = offset + query.pagination.limit < total;
    if (hasMore && projected.length > 0) {
      const lastDoc = projected[projected.length - 1];
      const lastId = lastDoc?.id;
      cursor =
        lastId !== undefined
          ? typeof lastId === 'object' && lastId !== null
            ? JSON.stringify(lastId)
            : String(lastId as string | number)
          : undefined;
    }
  }

  const executionTime = Date.now() - startTime;

  return {
    data: projected,
    total,
    cursor,
    hasMore,
    aggregations,
    executionTime,
  };
}

/**
 * Create a query executor with bound data source
 */
export class QueryExecutor<T extends Record<string, unknown>> {
  private data: T[] = [];
  private defaultOptions: QueryOptions;

  constructor(defaultOptions: QueryOptions = {}) {
    this.defaultOptions = defaultOptions;
  }

  /**
   * Set the data source
   */
  setData(data: T[]): void {
    this.data = data;
  }

  /**
   * Get the current data
   */
  getData(): T[] {
    return this.data;
  }

  /**
   * Execute a query
   */
  execute(query: QueryDefinition, options: QueryOptions = {}): QueryResult<T> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    return executeQuery(query, this.data, mergedOptions);
  }

  /**
   * Execute and return just the data
   */
  find(query: QueryDefinition, options?: QueryOptions): T[] {
    return this.execute(query, options).data;
  }

  /**
   * Find one document
   */
  findOne(query: QueryDefinition, options?: QueryOptions): T | undefined {
    const result = this.execute(
      {
        ...query,
        pagination: { limit: 1 },
      },
      options
    );
    return result.data[0];
  }

  /**
   * Count matching documents
   */
  count(query: QueryDefinition): number {
    const result = this.execute({
      ...query,
      pagination: undefined,
      aggregate: [{ type: 'count', alias: 'count' }],
    });
    return (result.aggregations?.count as number) ?? 0;
  }

  /**
   * Check if any documents match
   */
  exists(query: QueryDefinition): boolean {
    return this.count(query) > 0;
  }
}

/**
 * Create a query executor
 */
export function createQueryExecutor<T extends Record<string, unknown>>(
  options?: QueryOptions
): QueryExecutor<T> {
  return new QueryExecutor<T>(options);
}
