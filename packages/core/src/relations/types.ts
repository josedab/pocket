/**
 * @pocket/core - Relation Types
 *
 * Type definitions for document relationships and population.
 *
 * @module @pocket/core/relations
 */

import type { Document } from '../types/document.js';

/**
 * Relation type (one-to-one or one-to-many)
 */
export type RelationType = 'one' | 'many';

/**
 * Relation definition in schema
 */
export interface RelationDef {
  /** The collection being referenced */
  collection: string;
  /** Type of relationship */
  type: RelationType;
  /** Foreign key field in the target collection (defaults to '_id') */
  foreignKey?: string;
  /** Local key field (defaults to the field name) */
  localKey?: string;
}

/**
 * Populate options for a single relation
 */
export interface PopulateOption {
  /** Path to the field to populate */
  path: string;
  /** Fields to select from the related document */
  select?: string[];
  /** Filter for related documents */
  filter?: Record<string, unknown>;
  /** Nested populations */
  populate?: PopulateOption[];
  /** Maximum number of documents for 'many' relations */
  limit?: number;
  /** Sort for 'many' relations */
  sort?: { field: string; direction: 'asc' | 'desc' };
}

/**
 * Populate specification (can be string path or detailed options)
 */
export type PopulateSpec = string | PopulateOption;

/**
 * Result of population with metadata
 */
export interface PopulatedResult<T extends Document> {
  /** The document with populated fields */
  document: T;
  /** Population statistics */
  stats: {
    /** Number of relations resolved */
    relationsResolved: number;
    /** Number of documents fetched for population */
    documentsFetched: number;
    /** Execution time in ms */
    executionTimeMs: number;
  };
}

/**
 * Relation resolver context
 */
export interface RelationContext {
  /** Get a collection by name */
  getCollection: (name: string) => CollectionLike;
  /** Get relation definition from schema */
  getRelation: (collectionName: string, fieldPath: string) => RelationDef | undefined;
}

/**
 * Minimal collection interface for relation resolution
 */
export interface CollectionLike {
  /** Get documents by IDs */
  getMany: (ids: string[]) => Promise<(Document | null)[]>;
  /** Find documents by filter */
  find: (filter: Record<string, unknown>) => QueryLike;
}

/**
 * Minimal query interface for relation resolution
 */
export interface QueryLike {
  limit: (count: number) => QueryLike;
  sort: (field: string, direction: 'asc' | 'desc') => QueryLike;
  exec: () => Promise<Document[]>;
}
