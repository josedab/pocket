/**
 * In-Memory Storage Backend
 * Simple storage for development and testing
 */

import type { Document } from '@pocket/core';
import type { StorageBackend, SyncChange } from '../types.js';

/**
 * In-memory storage backend
 */
export class MemoryStorage implements StorageBackend {
  private readonly collections = new Map<string, Map<string, Document>>();
  private readonly changes: SyncChange[] = [];
  private readonly maxChanges: number;

  constructor(options: { maxChanges?: number } = {}) {
    this.maxChanges = options.maxChanges ?? 10000;
  }

  async getDocuments<T extends Document>(
    collection: string,
    options?: {
      since?: number;
      limit?: number;
      filter?: Record<string, unknown>;
    }
  ): Promise<T[]> {
    const coll = this.collections.get(collection);
    if (!coll) return [];

    let docs = Array.from(coll.values()) as T[];

    // Apply filter
    if (options?.filter) {
      docs = docs.filter((doc) => this.matchesFilter(doc, options.filter!));
    }

    // Filter by timestamp
    if (options?.since) {
      docs = docs.filter((doc) => {
        const updatedAt = (doc as Record<string, unknown>)._updatedAt as number | undefined;
        return updatedAt && updatedAt > options.since!;
      });
    }

    // Apply limit
    if (options?.limit) {
      docs = docs.slice(0, options.limit);
    }

    return docs;
  }

  async getDocument<T extends Document>(collection: string, documentId: string): Promise<T | null> {
    const coll = this.collections.get(collection);
    if (!coll) return null;

    return (coll.get(documentId) as T) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  async saveDocument<T extends Document>(collection: string, document: T): Promise<void> {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, new Map());
    }

    const coll = this.collections.get(collection)!;
    coll.set(document._id, document);
  }

  async deleteDocument(collection: string, documentId: string): Promise<void> {
    const coll = this.collections.get(collection);
    if (coll) {
      coll.delete(documentId);
    }
  }

  async getChanges(collection: string, since: number, limit?: number): Promise<SyncChange[]> {
    let changes = this.changes.filter(
      (c) => c.timestamp > since && this.getCollectionFromChange(c) === collection
    );

    if (limit) {
      changes = changes.slice(0, limit);
    }

    return changes;
  }

  async recordChange(change: SyncChange): Promise<void> {
    this.changes.push(change);

    // Enforce max changes
    while (this.changes.length > this.maxChanges) {
      this.changes.shift();
    }

    // Apply change to documents
    const collection = this.getCollectionFromChange(change);
    if (!collection) return;

    if (change.type === 'delete') {
      await this.deleteDocument(collection, change.documentId);
    } else if (change.document) {
      await this.saveDocument(collection, change.document);
    }
  }

  private getCollectionFromChange(change: SyncChange): string {
    // Get collection from the change's document metadata
    const doc = change.document;
    if (doc && '_collection' in doc) {
      return (doc as Record<string, unknown>)._collection as string;
    }
    // Fallback: parse from document ID if it contains collection
    // This is a simple approach - in production you'd track collection separately
    return 'default';
  }

  private matchesFilter(doc: Document, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      const docValue = (doc as unknown as Record<string, unknown>)[key];

      if (typeof value === 'object' && value !== null) {
        // Handle query operators
        const ops = value as Record<string, unknown>;

        for (const [op, opValue] of Object.entries(ops)) {
          switch (op) {
            case '$eq':
              if (docValue !== opValue) return false;
              break;
            case '$ne':
              if (docValue === opValue) return false;
              break;
            case '$gt':
              if (typeof docValue !== 'number' || docValue <= (opValue as number)) return false;
              break;
            case '$gte':
              if (typeof docValue !== 'number' || docValue < (opValue as number)) return false;
              break;
            case '$lt':
              if (typeof docValue !== 'number' || docValue >= (opValue as number)) return false;
              break;
            case '$lte':
              if (typeof docValue !== 'number' || docValue > (opValue as number)) return false;
              break;
            case '$in':
              if (!Array.isArray(opValue) || !opValue.includes(docValue)) return false;
              break;
            case '$nin':
              if (Array.isArray(opValue) && opValue.includes(docValue)) return false;
              break;
          }
        }
      } else {
        // Simple equality
        if (docValue !== value) return false;
      }
    }

    return true;
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.collections.clear();
    this.changes.length = 0;
  }

  /**
   * Get stats
   */
  getStats(): {
    collections: number;
    documents: number;
    changes: number;
  } {
    let documents = 0;
    for (const coll of this.collections.values()) {
      documents += coll.size;
    }

    return {
      collections: this.collections.size,
      documents,
      changes: this.changes.length,
    };
  }
}

/**
 * Create an in-memory storage backend
 */
export function createMemoryStorage(options?: { maxChanges?: number }): MemoryStorage {
  return new MemoryStorage(options);
}
