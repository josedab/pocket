/**
 * Core schema inference engine - analyzes documents and produces InferredSchema.
 *
 * @module
 */

import type {
  FieldStats,
  InferenceConfig,
  InferredField,
  InferredFieldType,
  InferredSchema,
  SchemaRecommendation,
  SemanticType,
} from './types.js';
import { DEFAULT_INFERENCE_CONFIG } from './types.js';
import { detectSemanticType, getPatternForSemanticType } from './patterns.js';

interface FieldAccumulator {
  fieldPath: string;
  typeCounts: Map<InferredFieldType, number>;
  semanticCounts: Map<SemanticType, number>;
  occurrences: number;
  uniqueValues: Set<string>;
  numericMin: number;
  numericMax: number;
  totalLength: number;
  stringCount: number;
  nestedAccumulators: Map<string, FieldAccumulator>;
  arrayItemAccumulator?: FieldAccumulator;
}

function createAccumulator(fieldPath: string): FieldAccumulator {
  return {
    fieldPath,
    typeCounts: new Map(),
    semanticCounts: new Map(),
    occurrences: 0,
    uniqueValues: new Set(),
    numericMin: Infinity,
    numericMax: -Infinity,
    totalLength: 0,
    stringCount: 0,
    nestedAccumulators: new Map(),
  };
}

function inferFieldType(value: unknown): InferredFieldType {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    if (!isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}/.test(value)) return 'date';
    return 'string';
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

function incrementMap<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function analyzeValue(acc: FieldAccumulator, value: unknown, config: InferenceConfig): void {
  acc.occurrences++;
  const type = inferFieldType(value);
  incrementMap(acc.typeCounts, type);

  if (acc.uniqueValues.size < config.enumThreshold + 1) {
    acc.uniqueValues.add(String(value));
  }

  if (type === 'string' && typeof value === 'string') {
    acc.totalLength += value.length;
    acc.stringCount++;
    if (config.detectSemanticTypes) {
      const semantic = detectSemanticType(value);
      incrementMap(acc.semanticCounts, semantic);
    }
  }

  if (type === 'number' && typeof value === 'number') {
    acc.numericMin = Math.min(acc.numericMin, value);
    acc.numericMax = Math.max(acc.numericMax, value);
  }

  if (type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const [key, nestedValue] of Object.entries(obj)) {
      const nestedPath = `${acc.fieldPath}.${key}`;
      let nested = acc.nestedAccumulators.get(key);
      if (!nested) {
        nested = createAccumulator(nestedPath);
        acc.nestedAccumulators.set(key, nested);
      }
      analyzeValue(nested, nestedValue, config);
    }
  }

  if (type === 'array' && Array.isArray(value)) {
    if (!acc.arrayItemAccumulator) {
      acc.arrayItemAccumulator = createAccumulator(`${acc.fieldPath}[]`);
    }
    for (const item of value) {
      analyzeValue(acc.arrayItemAccumulator, item, config);
    }
  }
}

function getPrimaryType(typeCounts: Map<InferredFieldType, number>): InferredFieldType {
  let maxCount = 0;
  let primary: InferredFieldType = 'unknown';
  for (const [type, count] of typeCounts) {
    if (type !== 'null' && count > maxCount) {
      maxCount = count;
      primary = type;
    }
  }
  return primary;
}

function getPrimarySemanticType(semanticCounts: Map<SemanticType, number>): SemanticType {
  let maxCount = 0;
  let primary: SemanticType = 'none';
  for (const [type, count] of semanticCounts) {
    if (type !== 'none' && count > maxCount) {
      maxCount = count;
      primary = type;
    }
  }
  return primary;
}

function buildFieldStats(acc: FieldAccumulator, totalDocs: number): FieldStats {
  const primaryType = getPrimaryType(acc.typeCounts);
  const nullCount = acc.typeCounts.get('null') ?? 0;
  const nonNullCount = acc.occurrences - nullCount;

  return {
    fieldPath: acc.fieldPath,
    types: new Map(acc.typeCounts),
    primaryType,
    semanticType: getPrimarySemanticType(acc.semanticCounts),
    nullable: nullCount > 0,
    required: acc.occurrences >= totalDocs * 0.95,
    confidence: {
      value: Math.min(nonNullCount / Math.max(totalDocs, 1), 1),
      sampleCount: acc.occurrences,
    },
    uniqueValues: acc.uniqueValues.size,
    minValue: acc.numericMin !== Infinity ? acc.numericMin : undefined,
    maxValue: acc.numericMax !== -Infinity ? acc.numericMax : undefined,
    avgLength: acc.stringCount > 0 ? acc.totalLength / acc.stringCount : undefined,
    enumCandidates: acc.uniqueValues.size <= 20 && acc.uniqueValues.size > 0
      ? [...acc.uniqueValues]
      : undefined,
  };
}

function buildInferredField(
  name: string,
  acc: FieldAccumulator,
  totalDocs: number,
  config: InferenceConfig,
): InferredField {
  const stats = buildFieldStats(acc, totalDocs);
  const pattern = getPatternForSemanticType(stats.semanticType);

  let items: InferredSchema | undefined;
  if (acc.arrayItemAccumulator) {
    items = buildSchemaFromAccumulators(
      new Map([['item', acc.arrayItemAccumulator]]),
      acc.arrayItemAccumulator.occurrences,
      config,
    );
  }

  let properties: ReadonlyMap<string, InferredField> | undefined;
  if (acc.nestedAccumulators.size > 0) {
    const nested = new Map<string, InferredField>();
    for (const [key, nestedAcc] of acc.nestedAccumulators) {
      const field = buildInferredField(key, nestedAcc, totalDocs, config);
      if (field.confidence.value >= config.minConfidence) {
        nested.set(key, field);
      }
    }
    properties = nested;
  }

  return {
    name,
    type: stats.primaryType,
    semanticType: stats.semanticType,
    required: stats.required,
    nullable: stats.nullable,
    confidence: stats.confidence,
    enumValues: stats.enumCandidates && stats.uniqueValues <= config.enumThreshold
      ? stats.enumCandidates
      : undefined,
    pattern,
    items,
    properties,
  };
}

function generateRecommendations(
  fields: ReadonlyMap<string, InferredField>,
): SchemaRecommendation[] {
  const recommendations: SchemaRecommendation[] = [];

  for (const [fieldPath, field] of fields) {
    // Recommend index for high-cardinality fields used frequently
    if (field.type === 'string' && field.required && field.confidence.value > 0.9) {
      if (field.semanticType === 'uuid' || field.semanticType === 'email') {
        recommendations.push({
          type: 'add-index',
          fieldPath,
          message: `Field '${fieldPath}' appears to be a unique ${field.semanticType}. Consider adding an index.`,
          confidence: field.confidence,
        });
      }
    }

    // Recommend enum for low-cardinality string fields
    if (field.enumValues && field.enumValues.length <= 10 && field.enumValues.length >= 2) {
      recommendations.push({
        type: 'add-enum',
        fieldPath,
        message: `Field '${fieldPath}' has only ${field.enumValues.length} unique values. Consider using an enum type.`,
        confidence: field.confidence,
      });
    }

    // Recommend pattern for semantic types
    if (field.semanticType !== 'none' && field.pattern) {
      recommendations.push({
        type: 'add-pattern',
        fieldPath,
        message: `Field '${fieldPath}' matches ${field.semanticType} pattern. Consider adding validation.`,
        confidence: field.confidence,
      });
    }
  }

  return recommendations;
}

function buildSchemaFromAccumulators(
  accumulators: Map<string, FieldAccumulator>,
  totalDocs: number,
  config: InferenceConfig,
): InferredSchema {
  const fields = new Map<string, InferredField>();

  for (const [name, acc] of accumulators) {
    const field = buildInferredField(name, acc, totalDocs, config);
    if (field.confidence.value >= config.minConfidence) {
      fields.set(name, field);
    }
  }

  const avgConfidence = fields.size > 0
    ? [...fields.values()].reduce((sum, f) => sum + f.confidence.value, 0) / fields.size
    : 0;

  const recommendations = config.generateRecommendations
    ? generateRecommendations(fields)
    : [];

  return {
    fields,
    totalDocumentsAnalyzed: totalDocs,
    confidence: { value: avgConfidence, sampleCount: totalDocs },
    recommendations,
  };
}

/**
 * Schema inference engine that analyzes document collections to produce
 * type-safe schema definitions with confidence scoring.
 *
 * @example
 * ```typescript
 * const engine = createInferenceEngine();
 * const schema = engine.analyze([
 *   { name: 'Alice', email: 'alice@example.com', age: 30 },
 *   { name: 'Bob', email: 'bob@test.com', age: 25 },
 * ]);
 * console.log(schema.fields.get('email')?.semanticType); // 'email'
 * ```
 */
export class InferenceEngine {
  private readonly config: InferenceConfig;

  constructor(config: Partial<InferenceConfig> = {}) {
    this.config = { ...DEFAULT_INFERENCE_CONFIG, ...config };
  }

  /**
   * Analyze an array of documents and infer the schema.
   */
  analyze(documents: readonly Record<string, unknown>[]): InferredSchema {
    if (documents.length === 0) {
      return {
        fields: new Map(),
        totalDocumentsAnalyzed: 0,
        confidence: { value: 0, sampleCount: 0 },
        recommendations: [],
      };
    }

    const sample = documents.length > this.config.maxSampleSize
      ? this.sampleDocuments(documents, this.config.maxSampleSize)
      : documents;

    const accumulators = new Map<string, FieldAccumulator>();

    for (const doc of sample) {
      for (const [key, value] of Object.entries(doc)) {
        let acc = accumulators.get(key);
        if (!acc) {
          acc = createAccumulator(key);
          accumulators.set(key, acc);
        }
        analyzeValue(acc, value, this.config);
      }
    }

    return buildSchemaFromAccumulators(accumulators, sample.length, this.config);
  }

  /**
   * Incrementally update a schema with new documents.
   */
  merge(existing: InferredSchema, newDocuments: readonly Record<string, unknown>[]): InferredSchema {
    // Re-analyze by treating the existing schema info as context
    // For simplicity, we re-run analysis on new docs and merge field info
    const newSchema = this.analyze(newDocuments);
    const mergedFields = new Map<string, InferredField>(existing.fields);

    for (const [name, field] of newSchema.fields) {
      const existingField = mergedFields.get(name);
      if (!existingField) {
        mergedFields.set(name, field);
      } else {
        // Keep the higher-confidence version
        mergedFields.set(name, existingField.confidence.value >= field.confidence.value
          ? existingField
          : field);
      }
    }

    const totalDocs = existing.totalDocumentsAnalyzed + newSchema.totalDocumentsAnalyzed;
    const avgConfidence = mergedFields.size > 0
      ? [...mergedFields.values()].reduce((sum, f) => sum + f.confidence.value, 0) / mergedFields.size
      : 0;

    return {
      fields: mergedFields,
      totalDocumentsAnalyzed: totalDocs,
      confidence: { value: avgConfidence, sampleCount: totalDocs },
      recommendations: this.config.generateRecommendations
        ? generateRecommendations(mergedFields)
        : [],
    };
  }

  private sampleDocuments(
    documents: readonly Record<string, unknown>[],
    size: number,
  ): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    const step = documents.length / size;
    for (let i = 0; i < size; i++) {
      result.push(documents[Math.floor(i * step)]!);
    }
    return result;
  }
}

/** Factory function to create an InferenceEngine. */
export function createInferenceEngine(config?: Partial<InferenceConfig>): InferenceEngine {
  return new InferenceEngine(config);
}
