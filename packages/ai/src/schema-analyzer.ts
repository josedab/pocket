/**
 * SchemaAnalyzer - Automatic schema extraction and analysis for Pocket databases.
 *
 * Samples documents from collections to infer field types, cardinality,
 * nullability, and data distributions. Produces CollectionSchema definitions
 * compatible with the SmartQueryEngine and QueryCopilot.
 *
 * @module schema-analyzer
 */

import type { CollectionSchema, SchemaField } from './smart-query.js';

/** Options for schema analysis */
export interface SchemaAnalyzerConfig {
  /** Maximum documents to sample per collection */
  readonly sampleSize?: number;
  /** Confidence threshold for type inference (0-1) */
  readonly confidenceThreshold?: number;
  /** Include sample documents in output */
  readonly includeSamples?: boolean;
  /** Maximum sample documents to include */
  readonly maxSampleDocs?: number;
}

/** Statistics for a single field */
export interface FieldStatistics {
  /** Field name */
  readonly name: string;
  /** Inferred type */
  readonly type: SchemaField['type'];
  /** Percentage of documents containing this field (0-100) */
  readonly presence: number;
  /** Number of distinct values observed */
  readonly distinctValues: number;
  /** Whether the field is likely required (presence > 95%) */
  readonly likelyRequired: boolean;
  /** Detected enum values if cardinality is low */
  readonly detectedEnums: string[] | null;
  /** Minimum value (for numbers/dates) */
  readonly min?: unknown;
  /** Maximum value (for numbers/dates) */
  readonly max?: unknown;
  /** Type confidence (0-1) */
  readonly confidence: number;
}

/** Analysis result for a single collection */
export interface CollectionAnalysis {
  /** Collection name */
  readonly name: string;
  /** Inferred schema */
  readonly schema: CollectionSchema;
  /** Per-field statistics */
  readonly fieldStats: FieldStatistics[];
  /** Total documents in the collection */
  readonly totalDocuments: number;
  /** Number of documents sampled */
  readonly sampledDocuments: number;
  /** Auto-generated description */
  readonly description: string;
}

/** Full database analysis result */
export interface DatabaseAnalysis {
  /** Analysis per collection */
  readonly collections: CollectionAnalysis[];
  /** Total collections analyzed */
  readonly totalCollections: number;
  /** Analysis timestamp */
  readonly analyzedAt: number;
  /** Analysis duration in milliseconds */
  readonly durationMs: number;
}

/** Minimal collection-like interface for analysis (avoids hard @pocket/core dep) */
export interface AnalyzableCollection {
  readonly name: string;
  find(options?: { limit?: number }): Promise<Record<string, unknown>[]>;
  count?(): Promise<number>;
}

/** Minimal database-like interface for analysis */
export interface AnalyzableDatabase {
  collectionNames(): string[] | Promise<string[]>;
  collection(name: string): AnalyzableCollection;
}

const DEFAULT_SAMPLE_SIZE = 100;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_MAX_SAMPLES = 3;
const LOW_CARDINALITY_THRESHOLD = 20;

/**
 * Analyzes Pocket database collections to extract schemas automatically.
 *
 * @example
 * ```typescript
 * import { SchemaAnalyzer } from '@pocket/ai';
 *
 * const analyzer = new SchemaAnalyzer({ sampleSize: 200 });
 * const analysis = await analyzer.analyzeDatabase(db);
 *
 * // Use extracted schemas with QueryCopilot
 * const schemas = analysis.collections.map(c => c.schema);
 * const copilot = createQueryCopilot({ adapter, collections: schemas });
 * ```
 */
export class SchemaAnalyzer {
  private readonly config: Required<SchemaAnalyzerConfig>;

  constructor(config: SchemaAnalyzerConfig = {}) {
    this.config = {
      sampleSize: config.sampleSize ?? DEFAULT_SAMPLE_SIZE,
      confidenceThreshold: config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      includeSamples: config.includeSamples ?? true,
      maxSampleDocs: config.maxSampleDocs ?? DEFAULT_MAX_SAMPLES,
    };
  }

  /** Analyze all collections in a database */
  async analyzeDatabase(db: AnalyzableDatabase): Promise<DatabaseAnalysis> {
    const start = Date.now();
    const names = await db.collectionNames();
    const collections: CollectionAnalysis[] = [];

    for (const name of names) {
      const coll = db.collection(name);
      const analysis = await this.analyzeCollection(coll);
      collections.push(analysis);
    }

    return {
      collections,
      totalCollections: collections.length,
      analyzedAt: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  /** Analyze a single collection */
  async analyzeCollection(collection: AnalyzableCollection): Promise<CollectionAnalysis> {
    const docs = await collection.find({ limit: this.config.sampleSize });
    const totalDocuments = collection.count ? await collection.count() : docs.length;
    const fieldMap = new Map<string, FieldAccumulator>();

    for (const doc of docs) {
      this.accumulateFields(doc, fieldMap, '');
    }

    const fieldStats: FieldStatistics[] = [];
    const schemaFields: SchemaField[] = [];

    for (const [name, acc] of fieldMap) {
      const stats = this.computeFieldStats(name, acc, docs.length);
      if (stats.confidence >= this.config.confidenceThreshold) {
        fieldStats.push(stats);
        schemaFields.push({
          name: stats.name,
          type: stats.type,
          required: stats.likelyRequired,
          description: this.generateFieldDescription(stats),
          ...(stats.detectedEnums ? { enum: stats.detectedEnums } : {}),
        });
      }
    }

    const schema: CollectionSchema = {
      name: collection.name,
      fields: schemaFields,
      description: this.generateCollectionDescription(collection.name, schemaFields, totalDocuments),
      ...(this.config.includeSamples
        ? { sampleDocuments: docs.slice(0, this.config.maxSampleDocs) }
        : {}),
    };

    return {
      name: collection.name,
      schema,
      fieldStats,
      totalDocuments,
      sampledDocuments: docs.length,
      description: schema.description ?? '',
    };
  }

  /** Extract schemas compatible with SmartQueryEngine */
  async extractSchemas(db: AnalyzableDatabase): Promise<CollectionSchema[]> {
    const analysis = await this.analyzeDatabase(db);
    return analysis.collections.map((c) => c.schema);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private accumulateFields(
    doc: Record<string, unknown>,
    map: Map<string, FieldAccumulator>,
    prefix: string,
  ): void {
    for (const [key, value] of Object.entries(doc)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      let acc = map.get(fullKey);
      if (!acc) {
        acc = { values: [], types: new Map(), nullCount: 0, totalSeen: 0 };
        map.set(fullKey, acc);
      }
      acc.totalSeen++;

      if (value === null || value === undefined) {
        acc.nullCount++;
        continue;
      }

      const inferredType = this.inferType(value);
      acc.types.set(inferredType, (acc.types.get(inferredType) ?? 0) + 1);
      acc.values.push(value);
    }
  }

  private inferType(value: unknown): SchemaField['type'] {
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(value) && !isNaN(Date.parse(value))) {
        return 'date';
      }
      return 'string';
    }
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object' && value !== null) {
      if (value instanceof Date) return 'date';
      return 'object';
    }
    return 'string';
  }

  private computeFieldStats(
    name: string,
    acc: FieldAccumulator,
    totalDocs: number,
  ): FieldStatistics {
    // Determine dominant type
    let dominantType: SchemaField['type'] = 'string';
    let maxCount = 0;
    for (const [type, count] of acc.types) {
      if (count > maxCount) {
        maxCount = count;
        dominantType = type;
      }
    }

    const presence = totalDocs > 0 ? (acc.totalSeen / totalDocs) * 100 : 0;
    const distinctValues = new Set(acc.values.map((v) => String(v))).size;
    const confidence = totalDocs > 0 ? maxCount / acc.totalSeen : 0;

    // Detect enums for low-cardinality string fields
    let detectedEnums: string[] | null = null;
    if (
      dominantType === 'string' &&
      distinctValues <= LOW_CARDINALITY_THRESHOLD &&
      distinctValues > 0
    ) {
      detectedEnums = [...new Set(acc.values.filter((v) => typeof v === 'string').map(String))];
    }

    // Min/max for numbers and dates
    let min: unknown;
    let max: unknown;
    if (dominantType === 'number') {
      const nums = acc.values.filter((v) => typeof v === 'number') as number[];
      if (nums.length > 0) {
        min = Math.min(...nums);
        max = Math.max(...nums);
      }
    }

    return {
      name,
      type: dominantType,
      presence: Math.round(presence * 100) / 100,
      distinctValues,
      likelyRequired: presence > 95,
      detectedEnums,
      min,
      max,
      confidence: Math.round(confidence * 1000) / 1000,
    };
  }

  private generateFieldDescription(stats: FieldStatistics): string {
    const parts: string[] = [`${stats.type} field`];
    if (stats.likelyRequired) parts.push('(required)');
    if (stats.detectedEnums) {
      parts.push(`with values: ${stats.detectedEnums.slice(0, 5).join(', ')}`);
    }
    if (stats.min !== undefined) parts.push(`range: ${String(stats.min)}-${String(stats.max)}`);
    return parts.join(' ');
  }

  private generateCollectionDescription(
    name: string,
    fields: SchemaField[],
    docCount: number,
  ): string {
    const fieldNames = fields.slice(0, 5).map((f) => f.name);
    return `Collection "${name}" with ${docCount} documents. Key fields: ${fieldNames.join(', ')}`;
  }
}

interface FieldAccumulator {
  values: unknown[];
  types: Map<SchemaField['type'], number>;
  nullCount: number;
  totalSeen: number;
}

/** Factory function to create a SchemaAnalyzer */
export function createSchemaAnalyzer(config?: SchemaAnalyzerConfig): SchemaAnalyzer {
  return new SchemaAnalyzer(config);
}
