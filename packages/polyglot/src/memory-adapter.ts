/**
 * In-memory database adapter for testing and lightweight use cases
 */

import type { DatabaseAdapter, PolyglotQuery, PolyglotResult } from './types.js';

/**
 * In-memory database adapter that stores data in Maps.
 * Supports basic CRUD operations with filtering, sorting, and pagination.
 */
export class MemoryAdapter implements DatabaseAdapter {
  readonly name: string;
  readonly type = 'memory' as const;

  private connected = false;
  private collections = new Map<string, Record<string, unknown>[]>();

  constructor(name: string) {
    this.name = name;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async healthCheck(): Promise<boolean> {
    return this.connected;
  }

  async execute<T = Record<string, unknown>>(query: PolyglotQuery): Promise<PolyglotResult<T>> {
    this.ensureConnected();

    const start = performance.now();

    let data: Record<string, unknown>[];
    switch (query.operation) {
      case 'select':
        data = this.handleSelect(query);
        break;
      case 'insert':
        data = this.handleInsert(query);
        break;
      case 'update':
        data = this.handleUpdate(query);
        break;
      case 'delete':
        data = this.handleDelete(query);
        break;
      default:
        throw new Error(`Unsupported operation: ${query.operation}`);
    }

    const executionTimeMs = performance.now() - start;

    return {
      data: data as T[],
      totalCount: data.length,
      executionTimeMs,
      sources: [this.name],
    };
  }

  /** Get all documents in a collection (for join support) */
  getCollection(name: string): Record<string, unknown>[] {
    return [...(this.collections.get(name) ?? [])];
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error(`Adapter "${this.name}" is not connected`);
    }
  }

  private getOrCreateCollection(name: string): Record<string, unknown>[] {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = [];
      this.collections.set(name, collection);
    }
    return collection;
  }

  private handleSelect(query: PolyglotQuery): Record<string, unknown>[] {
    const collection = this.collections.get(query.source) ?? [];
    let results = collection.filter((doc) => this.matchesFilter(doc, query.filter));

    if (query.sort) {
      results = this.applySort(results, query.sort);
    }

    if (query.limit !== undefined) {
      results = results.slice(0, query.limit);
    }

    if (query.projection) {
      results = results.map((doc) => this.applyProjection(doc, query.projection!));
    }

    return results;
  }

  private handleInsert(query: PolyglotQuery): Record<string, unknown>[] {
    const target = query.target ?? query.source;
    const collection = this.getOrCreateCollection(target);

    const docs = Array.isArray(query.data) ? query.data : query.data ? [query.data] : [];
    collection.push(...docs);

    return docs;
  }

  private handleUpdate(query: PolyglotQuery): Record<string, unknown>[] {
    const target = query.target ?? query.source;
    const collection = this.getOrCreateCollection(target);
    const updated: Record<string, unknown>[] = [];

    for (let i = 0; i < collection.length; i++) {
      const doc = collection[i]!;
      if (this.matchesFilter(doc, query.filter)) {
        collection[i] = { ...doc, ...(query.data as Record<string, unknown>) };
        updated.push(collection[i]!);
      }
    }

    return updated;
  }

  private handleDelete(query: PolyglotQuery): Record<string, unknown>[] {
    const target = query.target ?? query.source;
    const collection = this.collections.get(target);
    if (!collection) return [];

    const deleted: Record<string, unknown>[] = [];
    const remaining: Record<string, unknown>[] = [];

    for (const doc of collection) {
      if (this.matchesFilter(doc, query.filter)) {
        deleted.push(doc);
      } else {
        remaining.push(doc);
      }
    }

    this.collections.set(target, remaining);
    return deleted;
  }

  private matchesFilter(
    doc: Record<string, unknown>,
    filter?: Record<string, unknown>,
  ): boolean {
    if (!filter) return true;

    return Object.entries(filter).every(([key, value]) => {
      const docValue = doc[key];

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return this.matchesOperator(docValue, value as Record<string, unknown>);
      }

      return docValue === value;
    });
  }

  private matchesOperator(
    docValue: unknown,
    operators: Record<string, unknown>,
  ): boolean {
    return Object.entries(operators).every(([op, opValue]) => {
      switch (op) {
        case '$eq':
          return docValue === opValue;
        case '$gt':
          return typeof docValue === 'number' && typeof opValue === 'number' && docValue > opValue;
        case '$lt':
          return typeof docValue === 'number' && typeof opValue === 'number' && docValue < opValue;
        case '$in':
          return Array.isArray(opValue) && opValue.includes(docValue);
        default:
          return false;
      }
    });
  }

  private applySort(
    docs: Record<string, unknown>[],
    sort: Record<string, 1 | -1>,
  ): Record<string, unknown>[] {
    const entries = Object.entries(sort);
    return [...docs].sort((a, b) => {
      for (const [field, direction] of entries) {
        const aVal = a[field];
        const bVal = b[field];
        if (aVal === bVal) continue;
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;
        const cmp = (aVal as number) < (bVal as number) ? -1 : 1;
        return cmp * direction;
      }
      return 0;
    });
  }

  private applyProjection(
    doc: Record<string, unknown>,
    projection: string[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const field of projection) {
      if (field in doc) {
        result[field] = doc[field];
      }
    }
    return result;
  }
}

/**
 * Create an in-memory database adapter
 */
export function createMemoryAdapter(name = 'memory'): MemoryAdapter {
  return new MemoryAdapter(name);
}
