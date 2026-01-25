import type { Document } from '../types/document.js';
import type { QueryResult, QuerySpec, SortSpec } from '../types/query.js';
import { compareValues, getNestedValue, matchesFilter } from './operators.js';

/**
 * Executes queries against in-memory document collections.
 *
 * The QueryExecutor handles the core query execution pipeline:
 * 1. **Filtering** - Applies filter predicates to narrow down results
 * 2. **Sorting** - Orders results by one or more fields
 * 3. **Pagination** - Applies skip/limit for efficient data retrieval
 * 4. **Projection** - Selects or excludes specific fields from results
 *
 * This class is used internally by the {@link Collection} class and the
 * {@link LiveQuery} system to execute queries against cached documents.
 *
 * @typeParam T - The document type, must extend {@link Document}
 *
 * @example
 * ```typescript
 * const executor = new QueryExecutor<User>();
 *
 * const result = executor.execute(users, {
 *   filter: { status: 'active' },
 *   sort: [{ field: 'createdAt', direction: 'desc' }],
 *   limit: 10,
 *   skip: 0,
 * });
 *
 * console.log(result.documents);    // User[]
 * console.log(result.totalCount);   // Total matching (before pagination)
 * console.log(result.executionTimeMs); // Performance metric
 * ```
 *
 * @see {@link QueryBuilder} for the fluent query building API
 * @see {@link QuerySpec} for the query specification format
 */
export class QueryExecutor<T extends Document> {
  /**
   * Executes a query specification against a collection of documents.
   *
   * The execution follows this order:
   * 1. Filter documents matching the query predicate
   * 2. Count total matching documents (before pagination)
   * 3. Sort by specified fields and directions
   * 4. Apply skip offset for pagination
   * 5. Apply limit to cap result size
   * 6. Project fields (include/exclude)
   *
   * @param documents - The source documents to query against
   * @param spec - The query specification containing filter, sort, pagination, and projection
   * @returns A {@link QueryResult} containing the matched documents, total count, and execution time
   *
   * @example
   * ```typescript
   * // Complex query with all options
   * const result = executor.execute(products, {
   *   filter: {
   *     $and: [
   *       { category: 'electronics' },
   *       { price: { $lte: 500 } },
   *       { inStock: true }
   *     ]
   *   },
   *   sort: [
   *     { field: 'price', direction: 'asc' },
   *     { field: 'name', direction: 'asc' }
   *   ],
   *   skip: 20,
   *   limit: 10,
   *   projection: { description: 0, metadata: 0 }
   * });
   * ```
   */
  execute(documents: T[], spec: QuerySpec<T>): QueryResult<T> {
    const startTime = performance.now();

    let results = documents;

    // Filter
    if (spec.filter) {
      results = results.filter((doc) => matchesFilter(doc, spec.filter!));
    }

    // Count before skip/limit
    const totalCount = results.length;

    // Sort
    if (spec.sort && spec.sort.length > 0) {
      results = this.sortDocuments(results, spec.sort);
    }

    // Skip
    if (spec.skip && spec.skip > 0) {
      results = results.slice(spec.skip);
    }

    // Limit
    if (spec.limit && spec.limit > 0) {
      results = results.slice(0, spec.limit);
    }

    // Projection
    if (spec.projection) {
      results = results.map((doc) => this.applyProjection(doc, spec.projection!));
    }

    const executionTimeMs = performance.now() - startTime;

    return {
      documents: results,
      totalCount,
      executionTimeMs,
    };
  }

  /**
   * Sorts documents by multiple fields with configurable direction.
   *
   * Implements stable multi-field sorting where documents are compared
   * by each sort field in order until a non-zero comparison is found.
   *
   * @param documents - The documents to sort (a copy is made to preserve original)
   * @param sorts - Array of sort specifications, applied in order of priority
   * @returns A new sorted array of documents
   *
   * @internal
   */
  private sortDocuments(documents: T[], sorts: SortSpec<T>[]): T[] {
    return [...documents].sort((a, b) => {
      for (const sort of sorts) {
        const aValue = getNestedValue(a, sort.field);
        const bValue = getNestedValue(b, sort.field);
        const comparison = compareValues(aValue, bValue, sort.direction);
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
  }

  /**
   * Applies field projection to select or exclude fields from a document.
   *
   * Supports three projection modes:
   * - **Inclusion** (fields set to 1): Only return specified fields
   * - **Exclusion** (fields set to 0): Return all fields except specified
   * - **Mixed**: Treated as inclusion mode
   *
   * The `_id` field is always included unless explicitly excluded.
   *
   * @param doc - The source document to project
   * @param projection - Map of field names to include (1) or exclude (0)
   * @returns A new document with projection applied
   *
   * @example
   * ```typescript
   * // Inclusion: only return name and email
   * applyProjection(user, { name: 1, email: 1 });
   * // Result: { _id: '...', name: 'John', email: 'john@example.com' }
   *
   * // Exclusion: return all except password
   * applyProjection(user, { password: 0, salt: 0 });
   * // Result: { _id: '...', name: 'John', email: 'john@example.com' }
   * ```
   *
   * @internal
   */
  private applyProjection(doc: T, projection: Partial<Record<keyof T, 0 | 1>>): T {
    const entries = Object.entries(projection);
    const isInclusion = entries.some(([, v]) => v === 1);
    const isExclusion = entries.some(([, v]) => v === 0);

    if (isInclusion && isExclusion) {
      // Mixed projection - include fields marked 1, exclude others
      // (except _id which is always included unless explicitly excluded)
      const result: Partial<T> = { _id: doc._id } as Partial<T>;

      for (const [key, include] of entries) {
        if (include === 1) {
          (result as Record<string, unknown>)[key] = (doc as Record<string, unknown>)[key];
        }
      }

      return result as T;
    }

    if (isInclusion) {
      // Inclusion projection
      const result: Partial<T> = { _id: doc._id } as Partial<T>;

      for (const [key, include] of entries) {
        if (include === 1) {
          (result as Record<string, unknown>)[key] = (doc as Record<string, unknown>)[key];
        }
      }

      return result as T;
    }

    if (isExclusion) {
      // Exclusion projection
      const result = { ...doc };

      for (const [key, exclude] of entries) {
        if (exclude === 0) {
          Reflect.deleteProperty(result as Record<string, unknown>, key);
        }
      }

      return result;
    }

    return doc;
  }

  /**
   * Tests if a single document matches the query filter.
   *
   * This is a lightweight method useful for:
   * - Checking if a new/updated document should be included in cached results
   * - Validating documents against query criteria without full execution
   * - Implementing optimistic updates in the {@link LiveQuery} system
   *
   * @param doc - The document to test
   * @param spec - The query specification (only the filter is evaluated)
   * @returns `true` if the document matches the filter, `false` otherwise
   *
   * @example
   * ```typescript
   * const executor = new QueryExecutor<Todo>();
   *
   * const spec = { filter: { completed: false, priority: 'high' } };
   *
   * if (executor.matches(newTodo, spec)) {
   *   // Add to cached results
   * }
   * ```
   */
  matches(doc: T, spec: QuerySpec<T>): boolean {
    if (!spec.filter) return true;
    return matchesFilter(doc, spec.filter);
  }

  /**
   * Counts documents matching the query filter without full query execution.
   *
   * This is more efficient than `execute()` when you only need the count,
   * as it skips sorting, pagination, and projection.
   *
   * @param documents - The source documents to count against
   * @param spec - The query specification (only the filter is evaluated)
   * @returns The number of documents matching the filter
   *
   * @example
   * ```typescript
   * const executor = new QueryExecutor<Order>();
   *
   * // Count pending orders
   * const pendingCount = executor.count(orders, {
   *   filter: { status: 'pending' }
   * });
   *
   * // Count all documents (no filter)
   * const totalCount = executor.count(orders, {});
   * ```
   */
  count(documents: T[], spec: QuerySpec<T>): number {
    if (!spec.filter) return documents.length;
    return documents.filter((doc) => matchesFilter(doc, spec.filter!)).length;
  }
}
