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
export { createSchemaParser, SchemaParser } from './schema-parser.js';
export type { SchemaValidationError, SchemaValidationResult } from './schema-parser.js';

// Generators
export { TypeGenerator } from './generators/type-generator.js';
export { HookGenerator } from './generators/hook-generator.js';
export { ValidationGenerator } from './generators/validation-generator.js';
export { MigrationGenerator } from './generators/migration-generator.js';
export type { SchemaChange } from './generators/migration-generator.js';

// CRUD Generator
export { CRUDGenerator } from './generators/crud-generator.js';

// Form Generator
export { FormGenerator, createFormGenerator } from './generators/form-generator.js';

// API Generator
export { APIGenerator, createAPIGenerator } from './generators/api-generator.js';

// React Generator
export { ReactGenerator, createReactGenerator } from './generators/react-generator.js';

// AI Schema Generator
export { AISchemaGenerator, createAISchemaGenerator, SCHEMA_TEMPLATES } from './ai-schema-generator.js';
export type {
  AISchemaGeneratorConfig,
  SchemaGenerationRequest,
  SchemaGenerationResult,
} from './ai-schema-generator.js';

// Main Code Generator
export { CodeGenerator, createCodeGenerator } from './codegen.js';

// CLI
export { runCLI, parseArgs, type CLIOptions } from './cli.js';
