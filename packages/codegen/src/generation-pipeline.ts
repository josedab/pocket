/**
 * @pocket/codegen - Generation Pipeline
 *
 * High-level pipeline that chains multiple generators in sequence,
 * allowing selective code generation from Pocket schema definitions.
 *
 * @module @pocket/codegen
 */

import { APIGenerator } from './generators/api-generator.js';
import { CRUDGenerator } from './generators/crud-generator.js';
import { FormGenerator } from './generators/form-generator.js';
import { GraphQLGenerator } from './generators/graphql-generator.js';
import { HookGenerator } from './generators/hook-generator.js';
import { TypeGenerator } from './generators/type-generator.js';
import { ValidationGenerator } from './generators/validation-generator.js';
import { SchemaParser } from './schema-parser.js';
import type { CollectionSchema, GeneratedFile, PocketSchema } from './types.js';

/**
 * Generation targets that can be selected for output.
 */
export type GenerationTarget = 'types' | 'validation' | 'hooks' | 'forms' | 'api' | 'crud' | 'graphql' | 'all';

/**
 * Configuration for the generation pipeline.
 */
export interface PipelineConfig {
  /** Generation targets to include in the output */
  targets: GenerationTarget[];
  /** Output directory for generated files */
  outputDir?: string;
}

/**
 * Result of a pipeline run containing all generated file contents.
 */
export interface PipelineOutput {
  /** All generated files keyed by target */
  files: GeneratedFile[];
  /** Which targets were executed */
  targets: GenerationTarget[];
  /** Total number of generated files */
  fileCount: number;
}

/** Ordered list of concrete targets matching the pipeline sequence. */
const TARGET_ORDER: Exclude<GenerationTarget, 'all'>[] = [
  'types',
  'validation',
  'hooks',
  'forms',
  'api',
  'crud',
  'graphql',
];

/**
 * GenerationPipeline chains generators in sequence and collects output.
 */
export class GenerationPipeline {
  private readonly config: PipelineConfig;
  private readonly schemaParser: SchemaParser;
  private readonly typeGenerator: TypeGenerator;
  private readonly validationGenerator: ValidationGenerator;
  private readonly hookGenerator: HookGenerator;
  private readonly formGenerator: FormGenerator;
  private readonly apiGenerator: APIGenerator;
  private readonly crudGenerator: CRUDGenerator;
  private readonly graphqlGenerator: GraphQLGenerator;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.schemaParser = new SchemaParser();
    this.typeGenerator = new TypeGenerator();
    this.validationGenerator = new ValidationGenerator();
    this.hookGenerator = new HookGenerator();
    this.formGenerator = new FormGenerator();
    this.apiGenerator = new APIGenerator();
    this.crudGenerator = new CRUDGenerator();
    this.graphqlGenerator = new GraphQLGenerator();
  }

  /**
   * Run the pipeline against a single collection.
   *
   * @param schema - The full schema containing the collection
   * @param collectionName - Name of the collection to generate for
   * @returns Pipeline output with generated files
   * @throws Error if the schema is invalid or the collection is not found
   */
  generateForCollection(schema: PocketSchema, collectionName: string): PipelineOutput {
    this.validateSchema(schema);

    const collection = schema.collections.find((c) => c.name === collectionName);
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found in schema`);
    }

    return this.runGenerators([collection]);
  }

  /**
   * Run the pipeline against all collections in the schema.
   *
   * @param schema - The full schema definition
   * @returns Pipeline output with generated files
   * @throws Error if the schema is invalid
   */
  generate(schema: PocketSchema): PipelineOutput {
    this.validateSchema(schema);
    return this.runGenerators(schema.collections);
  }

  /**
   * Resolve which concrete targets should be executed.
   */
  private resolveTargets(): Exclude<GenerationTarget, 'all'>[] {
    if (this.config.targets.includes('all')) {
      return [...TARGET_ORDER];
    }
    // Preserve pipeline order regardless of config order
    return TARGET_ORDER.filter((t) => this.config.targets.includes(t));
  }

  /**
   * Validate the schema and throw on errors.
   */
  private validateSchema(schema: PocketSchema): void {
    const result = this.schemaParser.validate(schema);
    if (!result.valid) {
      const errorMessages = result.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
      throw new Error(`Invalid schema:\n${errorMessages}`);
    }
  }

  /**
   * Execute each enabled generator in sequence and collect files.
   */
  private runGenerators(collections: CollectionSchema[]): PipelineOutput {
    const activeTargets = this.resolveTargets();
    const files: GeneratedFile[] = [];

    for (const target of activeTargets) {
      const generated = this.runTarget(target, collections);
      files.push(...generated);
    }

    return {
      files,
      targets: activeTargets,
      fileCount: files.length,
    };
  }

  /**
   * Run a single generator target.
   */
  private runTarget(target: Exclude<GenerationTarget, 'all'>, collections: CollectionSchema[]): GeneratedFile[] {
    switch (target) {
      case 'types':
        return this.typeGenerator.generateTypes(collections);
      case 'validation':
        return this.validationGenerator.generateValidation(collections);
      case 'hooks':
        return this.hookGenerator.generateHooks(collections);
      case 'forms':
        return this.formGenerator.generateForms(collections);
      case 'api':
        return this.apiGenerator.generateAPI(collections);
      case 'crud':
        return this.crudGenerator.generateCRUD(collections);
      case 'graphql':
        return this.graphqlGenerator.generate(collections);
    }
  }
}

/**
 * Factory function to create a new GenerationPipeline instance.
 */
export function createGenerationPipeline(config: PipelineConfig): GenerationPipeline {
  return new GenerationPipeline(config);
}
