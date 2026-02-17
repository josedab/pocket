// Types
export type {
  SchemaDefinition,
  CollectionDef,
  FieldDef,
  FieldType,
  RelationDef,
  GeneratorTarget,
  GeneratedFile,
  GeneratorConfig,
  GeneratorResult,
  SchemaDiff,
} from './types.js';

// Schema Parser
export { createFullstackSchemaParser } from './schema-parser.js';
export type { SchemaParser } from './schema-parser.js';

// Type Generator
export { createTypeGenerator } from './type-generator.js';
export type { TypeGenerator } from './type-generator.js';

// Hooks Generator
export { createHooksGenerator } from './hooks-generator.js';
export type { HooksGenerator } from './hooks-generator.js';

// API Generator
export { createApiGenerator } from './api-generator.js';
export type { ApiGenerator, ApiGeneratorConfig } from './api-generator.js';

// Migration Generator
export { createFullstackMigrationGenerator } from './migration-generator.js';
export type { MigrationGenerator } from './migration-generator.js';

// Main entry point
import type { GeneratorConfig, GeneratorResult } from './types.js';
import { createFullstackSchemaParser } from './schema-parser.js';
import { createTypeGenerator } from './type-generator.js';
import { createHooksGenerator } from './hooks-generator.js';
import { createApiGenerator } from './api-generator.js';

/**
 * Creates a full-stack code generator that produces files for all configured targets.
 */
export function createFullstackCodeGenerator(config: GeneratorConfig) {
  const parser = createFullstackSchemaParser();
  const typeGen = createTypeGenerator();
  const hooksGen = createHooksGenerator();
  const apiGen = createApiGenerator({ framework: config.framework });

  return {
    generate(schema: Parameters<typeof parser.parse>[0]): GeneratorResult {
      const parsed = typeof schema === 'string' || (typeof schema === 'object' && !('collections' in (schema)))
        ? parser.parse(schema)
        : parser.parse(schema);

      const normalized = parser.normalize(parsed);
      const validation = parser.validate(normalized);
      const warnings: string[] = [];

      if (!validation.valid) {
        warnings.push(...validation.errors);
      }

      const files = [];

      for (const target of config.targets) {
        switch (target) {
          case 'typescript':
            files.push(...typeGen.generate(normalized).map((f) => ({
              ...f,
              path: `${config.outputDir}/${f.path}`,
            })));
            break;
          case 'react-hooks':
            files.push(...hooksGen.generate(normalized).map((f) => ({
              ...f,
              path: `${config.outputDir}/${f.path}`,
            })));
            break;
          case 'api-routes':
            files.push(...apiGen.generate(normalized).map((f) => ({
              ...f,
              path: `${config.outputDir}/${f.path}`,
            })));
            break;
          case 'validation':
            files.push(...typeGen.generateValidation(normalized).map((f) => ({
              ...f,
              path: `${config.outputDir}/${f.path}`,
            })));
            break;
        }
      }

      return { files, warnings };
    },
  };
}
