/**
 * Types for the schema inference engine.
 *
 * @module
 */

/** Inferred field type from document analysis */
export type InferredFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'date'
  | 'null'
  | 'unknown';

/** Semantic type detected via pattern matching */
export type SemanticType =
  | 'email'
  | 'url'
  | 'uuid'
  | 'iso-date'
  | 'phone'
  | 'ip-address'
  | 'hex-color'
  | 'json-string'
  | 'none';

/** Confidence level for an inference */
export interface ConfidenceScore {
  /** Value between 0 and 1 */
  readonly value: number;
  /** Number of samples analyzed */
  readonly sampleCount: number;
}

/** Statistics about a single field across all analyzed documents */
export interface FieldStats {
  readonly fieldPath: string;
  readonly types: ReadonlyMap<InferredFieldType, number>;
  readonly primaryType: InferredFieldType;
  readonly semanticType: SemanticType;
  readonly nullable: boolean;
  readonly required: boolean;
  readonly confidence: ConfidenceScore;
  readonly uniqueValues: number;
  readonly minValue?: number | string;
  readonly maxValue?: number | string;
  readonly avgLength?: number;
  readonly enumCandidates?: readonly string[];
}

/** A single inferred field definition */
export interface InferredField {
  readonly name: string;
  readonly type: InferredFieldType;
  readonly semanticType: SemanticType;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly confidence: ConfidenceScore;
  readonly description?: string;
  readonly enumValues?: readonly string[];
  readonly pattern?: string;
  readonly items?: InferredSchema;
  readonly properties?: ReadonlyMap<string, InferredField>;
}

/** Complete inferred schema for a collection */
export interface InferredSchema {
  readonly fields: ReadonlyMap<string, InferredField>;
  readonly totalDocumentsAnalyzed: number;
  readonly confidence: ConfidenceScore;
  readonly recommendations: readonly SchemaRecommendation[];
}

/** Actionable recommendation from inference */
export interface SchemaRecommendation {
  readonly type: 'add-index' | 'add-enum' | 'change-type' | 'add-required' | 'add-pattern';
  readonly fieldPath: string;
  readonly message: string;
  readonly confidence: ConfidenceScore;
}

/** Configuration for the inference engine */
export interface InferenceConfig {
  /** Maximum documents to sample (default: 1000) */
  readonly maxSampleSize: number;
  /** Minimum confidence to include a field (default: 0.5) */
  readonly minConfidence: number;
  /** Threshold for enum detection - max unique values (default: 20) */
  readonly enumThreshold: number;
  /** Whether to detect semantic types (default: true) */
  readonly detectSemanticTypes: boolean;
  /** Whether to generate recommendations (default: true) */
  readonly generateRecommendations: boolean;
}

/** Output format for code generation */
export type OutputFormat = 'typescript' | 'zod' | 'json-schema' | 'pocket-schema';

/** Generated code output */
export interface GeneratedSchema {
  readonly format: OutputFormat;
  readonly code: string;
  readonly inferredSchema: InferredSchema;
}

export const DEFAULT_INFERENCE_CONFIG: InferenceConfig = {
  maxSampleSize: 1000,
  minConfidence: 0.5,
  enumThreshold: 20,
  detectSemanticTypes: true,
  generateRecommendations: true,
};
