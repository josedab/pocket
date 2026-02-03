import type { Database, Document } from '@pocket/core';
import { Subject } from 'rxjs';
import type { DocumentEditorOptions, StudioEvent } from './types.js';

/**
 * Document Editor for creating, updating, and deleting documents.
 *
 * Provides write operations on Pocket collections with support for
 * read-only mode (which blocks all mutations) and change event emission.
 *
 * @example
 * ```typescript
 * const editor = createDocumentEditor(db);
 *
 * // Insert a document
 * const doc = await editor.insertDocument('users', { name: 'Alice', age: 30 });
 *
 * // Update a document
 * await editor.updateDocument('users', doc._id, { age: 31 });
 *
 * // Delete a document
 * await editor.deleteDocument('users', doc._id);
 * ```
 *
 * @example Read-only mode
 * ```typescript
 * const editor = createDocumentEditor(db, { readOnly: true });
 *
 * // This will throw an error
 * await editor.insertDocument('users', { name: 'Bob' });
 * // Error: Studio is in read-only mode
 * ```
 *
 * @see {@link createDocumentEditor} for the factory function
 */
export class DocumentEditor {
  private readonly db: Database;
  private readonly readOnly: boolean;
  private readonly events$ = new Subject<StudioEvent>();

  constructor(db: Database, options?: DocumentEditorOptions) {
    this.db = db;
    this.readOnly = options?.readOnly ?? false;
  }

  /**
   * Get the event stream for document modifications.
   *
   * @returns Observable of studio events
   */
  get events(): Subject<StudioEvent> {
    return this.events$;
  }

  /**
   * Insert a new document into a collection.
   *
   * @param collection - The collection name
   * @param doc - The document data to insert
   * @returns The inserted document with system fields populated
   * @throws Error if in read-only mode or if schema validation fails
   */
  async insertDocument(
    collection: string,
    doc: Record<string, unknown>
  ): Promise<Document> {
    this.ensureWritable();

    const coll = this.db.collection(collection);
    const inserted = await coll.insert(doc as Parameters<typeof coll.insert>[0]);

    this.events$.next({
      type: 'document:modified',
      collection,
      id: inserted._id,
    });

    return inserted;
  }

  /**
   * Update an existing document by ID.
   *
   * Only the specified fields are updated; other fields remain unchanged.
   *
   * @param collection - The collection name
   * @param id - The document ID to update
   * @param changes - Partial document with fields to update
   * @returns The updated document
   * @throws Error if in read-only mode, document not found, or validation fails
   */
  async updateDocument(
    collection: string,
    id: string,
    changes: Record<string, unknown>
  ): Promise<Document> {
    this.ensureWritable();

    const coll = this.db.collection(collection);
    const updated = await coll.update(id, changes as Parameters<typeof coll.update>[1]);

    this.events$.next({
      type: 'document:modified',
      collection,
      id,
    });

    return updated;
  }

  /**
   * Delete a single document by ID.
   *
   * @param collection - The collection name
   * @param id - The document ID to delete
   * @throws Error if in read-only mode
   */
  async deleteDocument(collection: string, id: string): Promise<void> {
    this.ensureWritable();

    const coll = this.db.collection(collection);
    await coll.delete(id);

    this.events$.next({
      type: 'document:modified',
      collection,
      id,
    });
  }

  /**
   * Delete multiple documents matching a filter.
   *
   * Queries documents matching the filter, then deletes each one.
   *
   * @param collection - The collection name
   * @param filter - Filter object to match documents for deletion
   * @returns The number of documents deleted
   * @throws Error if in read-only mode
   */
  async bulkDelete(
    collection: string,
    filter: Record<string, unknown>
  ): Promise<number> {
    this.ensureWritable();

    const coll = this.db.collection(collection);
    const docs = await coll.find(filter as Partial<Document>).exec();

    const ids = docs.map((doc) => doc._id);
    await coll.deleteMany(ids);

    for (const id of ids) {
      this.events$.next({
        type: 'document:modified',
        collection,
        id,
      });
    }

    return ids.length;
  }

  /**
   * Check if the editor is in read-only mode.
   *
   * @returns true if read-only, false otherwise
   */
  get isReadOnly(): boolean {
    return this.readOnly;
  }

  /**
   * Destroy the editor and complete the event stream.
   */
  destroy(): void {
    this.events$.complete();
  }

  /**
   * Ensure the editor is not in read-only mode.
   * @throws Error if read-only mode is enabled
   */
  private ensureWritable(): void {
    if (this.readOnly) {
      throw new Error('Studio is in read-only mode. Write operations are disabled.');
    }
  }
}

/**
 * Create a new DocumentEditor instance.
 *
 * @param db - The Pocket Database instance
 * @param options - Editor options (e.g., readOnly mode)
 * @returns A new DocumentEditor
 *
 * @example
 * ```typescript
 * import { createDocumentEditor } from '@pocket/studio';
 *
 * const editor = createDocumentEditor(db, { readOnly: false });
 * await editor.insertDocument('users', { name: 'Alice' });
 * ```
 */
export function createDocumentEditor(
  db: Database,
  options?: DocumentEditorOptions
): DocumentEditor {
  return new DocumentEditor(db, options);
}
