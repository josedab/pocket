/**
 * Relationship detection between document collections.
 * Analyzes field names and data to infer foreign key relationships,
 * embedded references, and cardinality.
 *
 * @module
 */

import type { InferredSchema, ConfidenceScore } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Type of relationship between two collections */
export type RelationshipType = 'one-to-one' | 'one-to-many' | 'many-to-many';

/** A detected relationship between two collections */
export interface DetectedRelationship {
  readonly source: string;
  readonly sourceField: string;
  readonly target: string;
  readonly targetField: string;
  readonly type: RelationshipType;
  readonly confidence: ConfidenceScore;
  readonly isEmbedded: boolean;
}

/** ER diagram node representing a collection */
export interface ERNode {
  readonly name: string;
  readonly fields: readonly string[];
}

/** ER diagram edge representing a relationship */
export interface EREdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly type: RelationshipType;
}

/** ER diagram data structure */
export interface ERDiagram {
  readonly nodes: readonly ERNode[];
  readonly edges: readonly EREdge[];
}

/** Input for relationship detection: collection name → schema + sample data */
export interface CollectionInput {
  readonly name: string;
  readonly schema: InferredSchema;
  readonly documents?: readonly Record<string, unknown>[];
}

/** Configuration for relationship detection */
export interface RelationshipDetectorConfig {
  /** Minimum confidence to include a relationship (default: 0.5) */
  readonly minConfidence: number;
  /** Suffix patterns that indicate foreign keys */
  readonly foreignKeySuffixes: readonly string[];
  /** Whether to validate relationships against actual data (default: true) */
  readonly validateWithData: boolean;
}

const DEFAULT_RELATIONSHIP_CONFIG: RelationshipDetectorConfig = {
  minConfidence: 0.5,
  foreignKeySuffixes: ['_id', 'Id', '_ID', 'Ref', '_ref'],
  validateWithData: true,
};

// ─── Foreign Key Pattern Matching ────────────────────────────────────────────

/** Check if a field name matches a foreign key pattern */
function matchesForeignKeyPattern(
  fieldName: string,
  suffixes: readonly string[],
): string | null {
  for (const suffix of suffixes) {
    if (fieldName.endsWith(suffix) && fieldName.length > suffix.length) {
      const base = fieldName.slice(0, fieldName.length - suffix.length);
      return base;
    }
  }
  return null;
}

/** Normalize a collection name for matching (lowercase, singular) */
function normalizeCollectionName(name: string): string {
  const lower = name.toLowerCase();
  // Simple singular: remove trailing 's' if present
  return lower.endsWith('s') ? lower.slice(0, -1) : lower;
}

/** Find matching collection for a foreign key base name */
function findTargetCollection(
  baseName: string,
  collections: readonly CollectionInput[],
  sourceCollection: string,
): CollectionInput | null {
  const normalized = normalizeCollectionName(baseName);
  for (const collection of collections) {
    if (collection.name === sourceCollection) continue;
    if (normalizeCollectionName(collection.name) === normalized) {
      return collection;
    }
  }
  return null;
}

// ─── Embedded Relationship Detection ─────────────────────────────────────────

/** Detect embedded/nested relationships within a schema */
function detectEmbeddedRelationships(
  collectionName: string,
  schema: InferredSchema,
): DetectedRelationship[] {
  const relationships: DetectedRelationship[] = [];

  for (const [fieldName, field] of schema.fields) {
    if (field.type === 'object' && field.properties && field.properties.size > 0) {
      relationships.push({
        source: collectionName,
        sourceField: fieldName,
        target: fieldName,
        targetField: 'self',
        type: 'one-to-one',
        confidence: { value: 0.7, sampleCount: field.confidence.sampleCount },
        isEmbedded: true,
      });
    }

    if (field.type === 'array' && field.items) {
      const itemFields = field.items.fields;
      const firstItem = itemFields.values().next().value;
      if (firstItem?.type === 'object') {
        relationships.push({
          source: collectionName,
          sourceField: fieldName,
          target: fieldName,
          targetField: 'self',
          type: 'one-to-many',
          confidence: { value: 0.7, sampleCount: field.confidence.sampleCount },
          isEmbedded: true,
        });
      }
    }
  }

  return relationships;
}

// ─── Data Validation ─────────────────────────────────────────────────────────

/** Validate a foreign key relationship by checking actual data overlap */
function validateRelationshipWithData(
  sourceDocuments: readonly Record<string, unknown>[],
  sourceField: string,
  targetDocuments: readonly Record<string, unknown>[],
  targetField: string,
): number {
  if (sourceDocuments.length === 0 || targetDocuments.length === 0) return 0.5;

  const targetValues = new Set<string>();
  for (const doc of targetDocuments) {
    const val = doc[targetField];
    if (val !== null && val !== undefined) {
      targetValues.add(String(val));
    }
  }

  if (targetValues.size === 0) return 0;

  let matchCount = 0;
  let totalCount = 0;
  for (const doc of sourceDocuments) {
    const val = doc[sourceField];
    if (val !== null && val !== undefined) {
      totalCount++;
      if (targetValues.has(String(val))) {
        matchCount++;
      }
    }
  }

  return totalCount > 0 ? matchCount / totalCount : 0;
}

/** Determine cardinality from data */
function inferCardinality(
  sourceDocuments: readonly Record<string, unknown>[],
  sourceField: string,
  targetDocuments: readonly Record<string, unknown>[],
  targetField: string,
): RelationshipType {
  const sourceToTarget = new Map<string, Set<string>>();
  const targetToSource = new Map<string, Set<string>>();

  for (const doc of sourceDocuments) {
    const srcVal = doc[sourceField];
    if (srcVal === null || srcVal === undefined) continue;
    const srcKey = String(srcVal);

    for (const tDoc of targetDocuments) {
      const tgtVal = tDoc[targetField];
      if (tgtVal === null || tgtVal === undefined) continue;
      if (String(tgtVal) === srcKey) {
        if (!sourceToTarget.has(srcKey)) sourceToTarget.set(srcKey, new Set());
        sourceToTarget.get(srcKey)!.add(String(tgtVal));

        const tgtKey = String(tgtVal);
        if (!targetToSource.has(tgtKey)) targetToSource.set(tgtKey, new Set());
        targetToSource.get(tgtKey)!.add(srcKey);
      }
    }
  }

  const maxSourceRefs = Math.max(
    0,
    ...[...targetToSource.values()].map(s => s.size),
  );

  // Check unique constraint on source side
  const sourceValues = sourceDocuments
    .map(d => d[sourceField])
    .filter(v => v !== null && v !== undefined)
    .map(String);
  const uniqueSourceValues = new Set(sourceValues);
  const sourceIsUnique = uniqueSourceValues.size === sourceValues.length;

  if (sourceIsUnique && maxSourceRefs <= 1) return 'one-to-one';
  if (maxSourceRefs > 1) return 'many-to-many';
  return 'one-to-many';
}

// ─── ER Diagram ──────────────────────────────────────────────────────────────

/** Build ER diagram data from collections and relationships */
function buildERDiagram(
  collections: readonly CollectionInput[],
  relationships: readonly DetectedRelationship[],
): ERDiagram {
  const nodes: ERNode[] = collections.map(c => ({
    name: c.name,
    fields: [...c.schema.fields.keys()],
  }));

  const edges: EREdge[] = relationships
    .filter(r => !r.isEmbedded)
    .map(r => ({
      from: r.source,
      to: r.target,
      label: `${r.sourceField} → ${r.targetField}`,
      type: r.type,
    }));

  return { nodes, edges };
}

// ─── Relationship Detector ───────────────────────────────────────────────────

/**
 * Detects relationships between document collections by analyzing
 * field naming conventions, data types, and actual document data.
 *
 * @example
 * ```typescript
 * const detector = createRelationshipDetector();
 * const result = detector.detect([
 *   { name: 'users', schema: userSchema, documents: users },
 *   { name: 'posts', schema: postSchema, documents: posts },
 * ]);
 * console.log(result.relationships); // [{ source: 'posts', sourceField: 'user_id', target: 'users', ... }]
 * console.log(result.erDiagram);     // { nodes: [...], edges: [...] }
 * ```
 */
export class RelationshipDetector {
  private readonly config: RelationshipDetectorConfig;

  constructor(config: Partial<RelationshipDetectorConfig> = {}) {
    this.config = { ...DEFAULT_RELATIONSHIP_CONFIG, ...config };
  }

  /**
   * Detect relationships across multiple collections.
   */
  detect(collections: readonly CollectionInput[]): {
    readonly relationships: readonly DetectedRelationship[];
    readonly erDiagram: ERDiagram;
  } {
    const relationships: DetectedRelationship[] = [];

    for (const collection of collections) {
      // Detect foreign key relationships
      const fkRelationships = this.detectForeignKeys(collection, collections);
      relationships.push(...fkRelationships);

      // Detect embedded relationships
      const embedded = detectEmbeddedRelationships(collection.name, collection.schema);
      relationships.push(...embedded);
    }

    // Filter by confidence
    const filtered = relationships.filter(
      r => r.confidence.value >= this.config.minConfidence,
    );

    const erDiagram = buildERDiagram(collections, filtered);

    return { relationships: filtered, erDiagram };
  }

  /**
   * Detect foreign key relationships from a single collection to others.
   */
  private detectForeignKeys(
    source: CollectionInput,
    allCollections: readonly CollectionInput[],
  ): DetectedRelationship[] {
    const results: DetectedRelationship[] = [];

    for (const [fieldName, field] of source.schema.fields) {
      if (field.type !== 'string' && field.type !== 'number') continue;

      const baseName = matchesForeignKeyPattern(fieldName, this.config.foreignKeySuffixes);
      if (!baseName) continue;

      const target = findTargetCollection(baseName, allCollections, source.name);
      if (!target) continue;

      // Find target's primary key field (usually 'id' or '_id')
      const targetField = this.findPrimaryKeyField(target.schema);
      if (!targetField) continue;

      let confidence = 0.6;
      let relType: RelationshipType = 'one-to-many';

      // Validate with data if available
      if (
        this.config.validateWithData &&
        source.documents &&
        target.documents &&
        source.documents.length > 0 &&
        target.documents.length > 0
      ) {
        const overlap = validateRelationshipWithData(
          source.documents,
          fieldName,
          target.documents,
          targetField,
        );
        confidence = Math.max(0.4, overlap);
        relType = inferCardinality(
          source.documents,
          fieldName,
          target.documents,
          targetField,
        );
      }

      results.push({
        source: source.name,
        sourceField: fieldName,
        target: target.name,
        targetField,
        type: relType,
        confidence: { value: confidence, sampleCount: field.confidence.sampleCount },
        isEmbedded: false,
      });
    }

    return results;
  }

  /** Find the primary key field in a schema (heuristic: 'id', '_id', or first uuid) */
  private findPrimaryKeyField(schema: InferredSchema): string | null {
    if (schema.fields.has('id')) return 'id';
    if (schema.fields.has('_id')) return '_id';

    for (const [name, field] of schema.fields) {
      if (field.semanticType === 'uuid') return name;
    }

    return null;
  }
}

/** Factory function to create a RelationshipDetector. */
export function createRelationshipDetector(
  config?: Partial<RelationshipDetectorConfig>,
): RelationshipDetector {
  return new RelationshipDetector(config);
}
