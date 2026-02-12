/**
 * @pocket/schema-inference - Automated schema inference for Pocket
 *
 * @example
 * ```typescript
 * import { createInferenceEngine, generateSchema } from '@pocket/schema-inference';
 *
 * const engine = createInferenceEngine();
 * const schema = engine.analyze([
 *   { name: 'Alice', email: 'alice@example.com', age: 30 },
 *   { name: 'Bob', email: 'bob@test.com', age: 25 },
 * ]);
 *
 * // Generate TypeScript types
 * const ts = generateSchema(schema, 'User', 'typescript');
 * console.log(ts.code);
 *
 * // Generate Zod schema
 * const zod = generateSchema(schema, 'User', 'zod');
 * console.log(zod.code);
 * ```
 */

// Types
export type {
  ConfidenceScore,
  FieldStats,
  GeneratedSchema,
  InferenceConfig,
  InferredField,
  InferredFieldType,
  InferredSchema,
  OutputFormat,
  SchemaRecommendation,
  SemanticType,
} from './types.js';

export { DEFAULT_INFERENCE_CONFIG } from './types.js';

// Inference Engine
export { InferenceEngine, createInferenceEngine } from './inference-engine.js';

// Pattern Detection
export { detectSemanticType, getPatternForSemanticType } from './patterns.js';

// Code Generation
export { generateAllFormats, generateSchema } from './code-generator.js';

// Relationship Detection
export type {
  CollectionInput,
  DetectedRelationship,
  ERDiagram,
  EREdge,
  ERNode,
  RelationshipDetectorConfig,
  RelationshipType,
} from './relationship-detector.js';
export { RelationshipDetector, createRelationshipDetector } from './relationship-detector.js';

// Migration Generation
export type {
  MigrationGeneratorConfig,
  MigrationPlan,
  MigrationScript,
  MigrationStep,
  MigrationStepType,
} from './migration-generator.js';
export { MigrationGenerator, createMigrationGenerator } from './migration-generator.js';

// Validation Suggestion
export type {
  ValidationRuleType,
  ValidationSuggesterConfig,
  ValidationSuggestion,
  ValidationSuggestionResult,
} from './validation-suggester.js';
export { ValidationSuggester, createValidationSuggester } from './validation-suggester.js';
