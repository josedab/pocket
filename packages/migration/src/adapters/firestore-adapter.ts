/**
 * FirestoreAdapter - Migration adapter for Google Cloud Firestore.
 *
 * Handles Firestore-style data with collections and documents.
 * Maps Firestore-specific types (Timestamp, GeoPoint, DocumentReference)
 * to Pocket types and flattens subcollections with path prefixes.
 *
 * @module firestore-adapter
 */

import type {
  CollectionMapping,
  SourceAnalysis,
  SourceDocument,
} from '../types.js';
import { MigrationAdapter, type GetDocumentsOptions } from './base-adapter.js';

/**
 * Firestore Timestamp representation.
 */
interface FirestoreTimestamp {
  _seconds: number;
  _nanoseconds: number;
}

/**
 * Firestore GeoPoint representation.
 */
interface FirestoreGeoPoint {
  _latitude: number;
  _longitude: number;
}

/**
 * Firestore DocumentReference representation.
 */
interface FirestoreReference {
  _path: string;
}

/**
 * Firestore document data format.
 */
interface FirestoreDocument {
  /** Document ID */
  id: string;

  /** Document fields */
  data: Record<string, unknown>;

  /** Optional subcollections */
  subcollections?: Record<string, FirestoreCollection>;
}

/**
 * Firestore collection data format.
 */
interface FirestoreCollection {
  /** Documents in this collection */
  docs: FirestoreDocument[];
}

/**
 * Firestore data format accepted by the adapter.
 *
 * @example
 * ```typescript
 * const data: FirestoreData = {
 *   collections: {
 *     users: {
 *       docs: [
 *         {
 *           id: 'user-1',
 *           data: {
 *             name: 'Alice',
 *             createdAt: { _seconds: 1700000000, _nanoseconds: 0 },
 *             location: { _latitude: 40.7, _longitude: -74.0 }
 *           },
 *           subcollections: {
 *             posts: {
 *               docs: [
 *                 { id: 'post-1', data: { title: 'Hello World' } }
 *               ]
 *             }
 *           }
 *         }
 *       ]
 *     }
 *   }
 * };
 * ```
 */
export interface FirestoreData {
  /** Map of collection names to their documents */
  collections: Record<string, FirestoreCollection>;
}

/**
 * Migration adapter for Google Cloud Firestore.
 *
 * Reads collections and documents from Firestore export format,
 * converts Firestore-specific types (Timestamp, GeoPoint, Reference),
 * and flattens subcollections using path prefixes (e.g. `users/posts`).
 *
 * @example
 * ```typescript
 * const adapter = createFirestoreAdapter(firestoreExportData);
 * const analysis = await adapter.analyze();
 * const collections = await adapter.getCollections();
 * ```
 *
 * @see {@link MigrationAdapter}
 */
export class FirestoreAdapter extends MigrationAdapter {
  /** @inheritdoc */
  readonly source = 'firestore' as const;

  private readonly data: FirestoreData;
  private readonly flatCollections = new Map<string, SourceDocument[]>();

  /**
   * Creates a new FirestoreAdapter.
   *
   * @param data - Firestore export data with collections and documents
   */
  constructor(data: FirestoreData) {
    super();
    this.data = data;
    this.flattenCollections();
  }

  /** @inheritdoc */
  async analyze(): Promise<SourceAnalysis> {
    const collections = [...this.flatCollections.keys()];
    let totalDocuments = 0;
    let estimatedSize = 0;

    for (const [, docs] of this.flatCollections) {
      totalDocuments += docs.length;
      estimatedSize += JSON.stringify(docs).length;
    }

    return {
      collections,
      totalDocuments,
      estimatedSizeBytes: estimatedSize,
    };
  }

  /** @inheritdoc */
  async getCollections(): Promise<string[]> {
    return [...this.flatCollections.keys()];
  }

  /** @inheritdoc */
  async getDocuments(
    collection: string,
    options?: GetDocumentsOptions,
  ): Promise<SourceDocument[]> {
    const docs = this.flatCollections.get(collection) ?? [];
    const skip = options?.skip ?? 0;
    const limit = options?.limit ?? docs.length;
    return docs.slice(skip, skip + limit);
  }

  /** @inheritdoc */
  async getDocumentCount(collection: string): Promise<number> {
    return this.flatCollections.get(collection)?.length ?? 0;
  }

  /** @inheritdoc */
  async getSchema(collection: string): Promise<CollectionMapping> {
    const docs = this.flatCollections.get(collection) ?? [];
    const sample = docs[0] ?? {};
    const fieldMappings = this.inferFieldMappings(sample, ['_id', '_meta']);

    // Map the target collection name by replacing path separators
    const targetCollection = collection.replace(/\//g, '_');

    return {
      sourceCollection: collection,
      targetCollection,
      fieldMappings,
    };
  }

  /**
   * Converts Firestore-specific types to Pocket-compatible values.
   *
   * - Timestamp → ISO 8601 date string
   * - GeoPoint → `{ lat, lng }` object
   * - DocumentReference → path string
   */
  private convertValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (this.isTimestamp(value)) {
      return new Date(value._seconds * 1000 + value._nanoseconds / 1_000_000).toISOString();
    }

    if (this.isGeoPoint(value)) {
      return { lat: value._latitude, lng: value._longitude };
    }

    if (this.isReference(value)) {
      return value._path;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.convertValue(item));
    }

    if (typeof value === 'object') {
      const converted: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        converted[key] = this.convertValue(val);
      }
      return converted;
    }

    return value;
  }

  /**
   * Flattens all collections including subcollections into a flat map.
   * Subcollections are prefixed with their parent path (e.g. `users/posts`).
   */
  private flattenCollections(): void {
    for (const [collectionName, collection] of Object.entries(this.data.collections)) {
      this.processCollection(collectionName, collection);
    }
  }

  /**
   * Processes a single collection and its subcollections recursively.
   */
  private processCollection(path: string, collection: FirestoreCollection): void {
    const docs: SourceDocument[] = [];

    for (const firestoreDoc of collection.docs) {
      const convertedData: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(firestoreDoc.data)) {
        convertedData[key] = this.convertValue(value);
      }

      docs.push({
        _id: firestoreDoc.id,
        ...convertedData,
      });

      // Process subcollections
      if (firestoreDoc.subcollections) {
        for (const [subName, subCollection] of Object.entries(firestoreDoc.subcollections)) {
          this.processCollection(`${path}/${subName}`, subCollection);
        }
      }
    }

    // Merge with existing docs if collection path already seen
    const existing = this.flatCollections.get(path) ?? [];
    this.flatCollections.set(path, [...existing, ...docs]);
  }

  private isTimestamp(value: unknown): value is FirestoreTimestamp {
    return (
      typeof value === 'object' &&
      value !== null &&
      '_seconds' in value &&
      '_nanoseconds' in value
    );
  }

  private isGeoPoint(value: unknown): value is FirestoreGeoPoint {
    return (
      typeof value === 'object' &&
      value !== null &&
      '_latitude' in value &&
      '_longitude' in value
    );
  }

  private isReference(value: unknown): value is FirestoreReference {
    return (
      typeof value === 'object' &&
      value !== null &&
      '_path' in value &&
      Object.keys(value).length === 1
    );
  }
}

/**
 * Creates a new Firestore migration adapter.
 *
 * @param data - Firestore export data with collections and documents
 * @returns A configured FirestoreAdapter instance
 *
 * @example
 * ```typescript
 * const adapter = createFirestoreAdapter({
 *   collections: {
 *     users: {
 *       docs: [
 *         { id: 'u1', data: { name: 'Alice', age: 30 } }
 *       ]
 *     }
 *   }
 * });
 * ```
 */
export function createFirestoreAdapter(data: FirestoreData): FirestoreAdapter {
  return new FirestoreAdapter(data);
}
