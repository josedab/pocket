/**
 * InMemorySyncStorage - In-memory implementation of EdgeSyncStorage.
 *
 * Useful for testing and development. Not suitable for production.
 */

import type { EdgeSyncStorage, SyncChange } from './edge-sync-server.js';

export class InMemorySyncStorage implements EdgeSyncStorage {
  private readonly changes: SyncChange[] = [];
  private readonly documents = new Map<string, Map<string, Record<string, unknown>>>();
  private readonly checkpoints = new Map<string, string>();

  async getChanges(collection: string, sinceCheckpoint: string | null, limit: number): Promise<SyncChange[]> {
    let filtered = collection === '*'
      ? this.changes
      : this.changes.filter((c) => c.collection === collection);

    if (sinceCheckpoint) {
      const index = this.changes.findIndex((c) => c.checkpoint === sinceCheckpoint);
      if (index >= 0) {
        filtered = filtered.filter((c) => this.changes.indexOf(c) > index);
      }
    }

    return filtered.slice(0, limit);
  }

  async putChanges(changes: SyncChange[]): Promise<void> {
    for (const change of changes) {
      this.changes.push(change);

      if (!this.documents.has(change.collection)) {
        this.documents.set(change.collection, new Map());
      }
      const collection = this.documents.get(change.collection)!;

      if (change.operation === 'delete') {
        collection.delete(change.documentId);
      } else if (change.data) {
        collection.set(change.documentId, {
          ...change.data,
          _id: change.documentId,
          _timestamp: change.timestamp,
        });
      }
    }
  }

  async getCheckpoint(clientId: string): Promise<string | null> {
    return this.checkpoints.get(clientId) ?? null;
  }

  async setCheckpoint(clientId: string, checkpoint: string): Promise<void> {
    this.checkpoints.set(clientId, checkpoint);
  }

  async getDocument(collection: string, id: string): Promise<Record<string, unknown> | null> {
    return this.documents.get(collection)?.get(id) ?? null;
  }

  getChangeCount(): number {
    return this.changes.length;
  }

  getDocumentCount(collection?: string): number {
    if (collection) {
      return this.documents.get(collection)?.size ?? 0;
    }
    let total = 0;
    for (const coll of this.documents.values()) {
      total += coll.size;
    }
    return total;
  }

  clear(): void {
    this.changes.length = 0;
    this.documents.clear();
    this.checkpoints.clear();
  }
}

export function createInMemorySyncStorage(): InMemorySyncStorage {
  return new InMemorySyncStorage();
}
