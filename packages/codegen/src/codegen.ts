/**
 * @pocket/codegen - Main Code Generator
 *
 * Orchestrates all code generation from Pocket schema definitions.
 *
 * @module @pocket/codegen
 */

import { HookGenerator } from './generators/hook-generator.js';
import { MigrationGenerator } from './generators/migration-generator.js';
import { TypeGenerator } from './generators/type-generator.js';
import { ValidationGenerator } from './generators/validation-generator.js';
import { SchemaParser } from './schema-parser.js';
import type { GeneratedFile, GeneratorOptions, PocketSchema } from './types.js';

/**
 * CodeGenerator orchestrates all generators to produce a complete set
 * of generated files from a Pocket schema.
 */
export class CodeGenerator {
  private readonly typeGenerator: TypeGenerator;
  private readonly hookGenerator: HookGenerator;
  private readonly validationGenerator: ValidationGenerator;
  private readonly migrationGenerator: MigrationGenerator;
  private readonly schemaParser: SchemaParser;

  constructor() {
    this.typeGenerator = new TypeGenerator();
    this.hookGenerator = new HookGenerator();
    this.validationGenerator = new ValidationGenerator();
    this.migrationGenerator = new MigrationGenerator();
    this.schemaParser = new SchemaParser();
  }

  /**
   * Generate code from a schema definition.
   *
   * Runs each enabled generator and collects all generated files.
   * By default, only type generation is enabled. Other generators
   * can be enabled via the options parameter.
   *
   * @param options - Generator options including schema, output directory, and feature flags
   * @returns Array of all generated files
   * @throws Error if the schema is invalid
   */
  generate(options: GeneratorOptions): GeneratedFile[] {
    const { schema, generateTypes = true, generateHooks = false, generateValidation = false } = options;

    // Validate schema first
    const validationResult = this.schemaParser.validate(schema);
    if (!validationResult.valid) {
      const errorMessages = validationResult.errors
        .map((e) => `  - ${e.path}: ${e.message}`)
        .join('\n');
      throw new Error(`Invalid schema:\n${errorMessages}`);
    }

    const files: GeneratedFile[] = [];

    // Generate types
    if (generateTypes) {
      const typeFiles = this.typeGenerator.generateTypes(schema.collections);
      files.push(...typeFiles);
    }

    // Generate hooks
    if (generateHooks) {
      const hookFiles = this.hookGenerator.generateHooks(schema.collections);
      files.push(...hookFiles);
    }

    // Generate validation
    if (generateValidation) {
      const validationFiles = this.validationGenerator.generateValidation(schema.collections);
      files.push(...validationFiles);
    }

    return files;
  }

  /**
   * Generate a migration by comparing two schemas.
   *
   * @param oldSchema - The previous schema
   * @param newSchema - The new schema
   * @returns Generated migration file, or null if no changes
   */
  generateMigration(oldSchema: PocketSchema, newSchema: PocketSchema): GeneratedFile | null {
    return this.migrationGenerator.generateMigration(oldSchema, newSchema);
  }

  /**
   * Parse and validate a schema from JSON string or object.
   *
   * @param input - JSON string or PocketSchema object
   * @returns Parsed and validated schema
   * @throws Error if the input is not valid JSON or the schema is invalid
   */
  parseAndValidate(input: string | PocketSchema): PocketSchema {
    const schema = this.schemaParser.parseSchema(input);
    const result = this.schemaParser.validate(schema);

    if (!result.valid) {
      const errorMessages = result.errors
        .map((e) => `  - ${e.path}: ${e.message}`)
        .join('\n');
      throw new Error(`Invalid schema:\n${errorMessages}`);
    }

    return schema;
  }
}

/**
 * Factory function to create a new CodeGenerator instance.
 */
export function createCodeGenerator(): CodeGenerator {
  return new CodeGenerator();
}
