/**
 * @pocket/codegen - Schema-driven Code Generation
 *
 * Generate TypeScript types, React hooks, Zod validators, and
 * migration files from Pocket schema definitions.
 *
 * @example
 * ```typescript
 * import { createCodeGenerator, createSchemaParser } from '@pocket/codegen';
 * import type { PocketSchema } from '@pocket/codegen';
 *
 * const schema: PocketSchema = {
 *   version: '1.0.0',
 *   collections: [{
 *     name: 'todos',
 *     fields: {
 *       title: { type: 'string', required: true },
 *       completed: { type: 'boolean', default: false },
 *     },
 *   }],
 * };
 *
 * const generator = createCodeGenerator();
 * const files = generator.generate({
 *   schema,
 *   outputDir: './src/generated',
 *   generateTypes: true,
 *   generateHooks: true,
 *   generateValidation: true,
 * });
 * ```
 *
 * @module @pocket/codegen
 */

// Types
export type {
  CollectionSchema,
  GeneratedFile,
  GeneratorOptions,
  PocketSchema,
  SchemaField,
  SchemaFieldType,
} from './types.js';

// Schema Parser
export { SchemaParser, createSchemaParser } from './schema-parser.js';
export type { SchemaValidationError, SchemaValidationResult } from './schema-parser.js';

// Generators
export { HookGenerator } from './generators/hook-generator.js';
export { MigrationGenerator } from './generators/migration-generator.js';
export type { SchemaChange } from './generators/migration-generator.js';
export { TypeGenerator } from './generators/type-generator.js';
export { ValidationGenerator } from './generators/validation-generator.js';

// CRUD Generator
export { CRUDGenerator } from './generators/crud-generator.js';

// Form Generator
export { FormGenerator, createFormGenerator } from './generators/form-generator.js';

// API Generator
export { APIGenerator, createAPIGenerator } from './generators/api-generator.js';

// React Generator
export { ReactGenerator, createReactGenerator } from './generators/react-generator.js';

// AI Schema Generator
export {
  AISchemaGenerator,
  SCHEMA_TEMPLATES,
  createAISchemaGenerator,
} from './ai-schema-generator.js';
export type {
  AISchemaGeneratorConfig,
  SchemaGenerationRequest,
  SchemaGenerationResult,
} from './ai-schema-generator.js';

// Full-Stack Generator
export { FullStackGenerator, createFullStackGenerator } from './generators/fullstack-generator.js';
export type { FullStackGeneratorConfig } from './generators/fullstack-generator.js';

// Zod Generator
export { createZodGenerator } from './generators/zod-generator.js';
export type { FieldDef, SchemaDefinition, ZodGeneratorHandle } from './generators/zod-generator.js';

// Watch Mode
export { createWatchMode } from './watch-mode.js';
export type { WatchEvent, WatchFs, WatchModeConfig, WatchModeHandle } from './watch-mode.js';

// Main Code Generator
export { CodeGenerator, createCodeGenerator } from './codegen.js';

// Generation Pipeline
export { GenerationPipeline, createGenerationPipeline } from './generation-pipeline.js';
export type { GenerationTarget, PipelineConfig, PipelineOutput } from './generation-pipeline.js';

// DSL Schema Parser
export { createDSLParser, parsePocketSchema, schemaToCodegenInput } from './schema-dsl.js';
export type {
  DslFieldType,
  PocketCollectionDef,
  PocketDslSchema,
  PocketFieldDef,
  SchemaParseError,
  SchemaParseResult,
} from './schema-dsl.js';

// GraphQL Generator
export { GraphQLGenerator, createGraphQLGenerator } from './generators/graphql-generator.js';
export type { GraphQLGeneratorConfig } from './generators/graphql-generator.js';

// CLI
export { parseArgs, runCLI, type CLIOptions } from './cli.js';

// Typed Query Generator
export { TypedQueryGenerator, createTypedQueryGenerator } from './typed-query-generator.js';
export type { TypedQueryGeneratorConfig } from './typed-query-generator.js';

// Schema Contract Engine
export {
  SchemaContractEngine,
  createSchemaContractEngine,
  generateFromContract,
  parseSchemaContract,
} from './schema-contract-engine.js';
export type {
  CollectionOptions,
  ContractParseResult,
  GeneratedOutput,
  ParsedCollection,
  ParsedField,
  SchemaContractConfig,
} from './schema-contract-engine.js';
