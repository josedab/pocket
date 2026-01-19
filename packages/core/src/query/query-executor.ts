import type { Document } from '../types/document.js';
import type { QueryResult, QuerySpec, SortSpec } from '../types/query.js';
import { compareValues, getNestedValue, matchesFilter } from './operators.js';

/**
 * Query executor - executes queries against documents
 */
export class QueryExecutor<T extends Document> {
  /**
   * Execute a query against a set of documents
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
   * Sort documents by multiple fields
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
   * Apply projection to a document
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
   * Check if a single document matches the query
   */
  matches(doc: T, spec: QuerySpec<T>): boolean {
    if (!spec.filter) return true;
    return matchesFilter(doc, spec.filter);
  }

  /**
   * Count documents matching query (without full execution)
   */
  count(documents: T[], spec: QuerySpec<T>): number {
    if (!spec.filter) return documents.length;
    return documents.filter((doc) => matchesFilter(doc, spec.filter!)).length;
  }
}
