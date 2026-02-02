/**
 * @pocket/codegen - Validation Generator
 *
 * Generates Zod validation schemas from Pocket collection schemas.
 *
 * @module @pocket/codegen
 */

import type { CollectionSchema, GeneratedFile, SchemaField } from '../types.js';

/**
 * Convert a collection name to PascalCase, removing trailing 's'.
 */
function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '');
}

/**
 * Convert a collection name to a singular PascalCase form.
 */
function toSingular(name: string): string {
  return toPascalCase(name);
}

/**
 * Convert a collection name to camelCase.
 */
function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Generate a Zod validator expression for a single field.
 *
 * @param field - The schema field to convert
 * @param indent - Current indentation level
 * @param isArrayItem - When true, skip optional/default handling (array items are not individually optional)
 */
function fieldToZod(field: SchemaField, indent = 2, isArrayItem = false): string {
  let zodExpr: string;

  switch (field.type) {
    case 'string': {
      zodExpr = 'z.string()';
      if (field.validation?.min !== undefined) {
        zodExpr += `.min(${field.validation.min})`;
      }
      if (field.validation?.max !== undefined) {
        zodExpr += `.max(${field.validation.max})`;
      }
      if (field.validation?.pattern) {
        zodExpr += `.regex(new RegExp('${field.validation.pattern.replace(/'/g, "\\'")}'))`;
      }
      if (field.validation?.enum && field.validation.enum.length > 0) {
        const enumValues = field.validation.enum.map((v) => JSON.stringify(v));
        zodExpr = `z.enum([${enumValues.join(', ')}])`;
      }
      break;
    }
    case 'number': {
      zodExpr = 'z.number()';
      if (field.validation?.min !== undefined) {
        zodExpr += `.min(${field.validation.min})`;
      }
      if (field.validation?.max !== undefined) {
        zodExpr += `.max(${field.validation.max})`;
      }
      break;
    }
    case 'boolean':
      zodExpr = 'z.boolean()';
      break;
    case 'date':
      zodExpr = 'z.coerce.date()';
      break;
    case 'reference':
      zodExpr = 'z.string()';
      break;
    case 'array': {
      if (field.items) {
        const itemsZod = fieldToZod(field.items, indent, true);
        zodExpr = `z.array(${itemsZod})`;
      } else {
        zodExpr = 'z.array(z.unknown())';
      }
      if (field.validation?.min !== undefined) {
        zodExpr += `.min(${field.validation.min})`;
      }
      if (field.validation?.max !== undefined) {
        zodExpr += `.max(${field.validation.max})`;
      }
      break;
    }
    case 'object': {
      if (field.properties) {
        zodExpr = generateZodObject(field.properties, indent);
      } else {
        zodExpr = 'z.record(z.string(), z.unknown())';
      }
      break;
    }
    default:
      zodExpr = 'z.unknown()';
  }

  // Handle optional fields and defaults (skip for array items)
  if (!isArrayItem) {
    if (!field.required) {
      zodExpr += '.optional()';
    }

    if (field.default !== undefined) {
      zodExpr += `.default(${JSON.stringify(field.default)})`;
    }
  }

  return zodExpr;
}

/**
 * Generate a z.object() expression from nested properties.
 */
function generateZodObject(
  properties: Record<string, SchemaField>,
  indent: number
): string {
  const innerIndent = indent + 2;
  const spaces = ' '.repeat(innerIndent);
  const closingSpaces = ' '.repeat(indent);

  const entries: string[] = [];
  for (const [propName, propField] of Object.entries(properties)) {
    entries.push(`${spaces}${propName}: ${fieldToZod(propField, innerIndent)}`);
  }

  return `z.object({\n${entries.join(',\n')},\n${closingSpaces}})`;
}

/**
 * Generate Zod schema content for a single collection.
 */
function generateCollectionZodSchema(collection: CollectionSchema): string {
  const singular = toSingular(collection.name);
  const camel = toCamelCase(collection.name);
  const schemaVarName = `${camel}Schema`;

  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Zod validation schema for ${singular} documents`);
  lines.push(` */`);

  // Build z.object entries
  const entries: string[] = [];
  for (const [fieldName, field] of Object.entries(collection.fields)) {
    entries.push(`  ${fieldName}: ${fieldToZod(field, 2)}`);
  }

  // Add timestamp fields
  if (collection.timestamps) {
    entries.push(`  createdAt: z.coerce.date()`);
    entries.push(`  updatedAt: z.coerce.date()`);
  }

  // Add soft delete field
  if (collection.softDelete) {
    entries.push(`  deletedAt: z.coerce.date().optional()`);
  }

  lines.push(`export const ${schemaVarName} = z.object({`);
  lines.push(entries.join(',\n') + ',');
  lines.push(`});`);
  lines.push(``);

  // Inferred type
  lines.push(`/**`);
  lines.push(` * Inferred type from the ${singular} Zod schema`);
  lines.push(` */`);
  lines.push(`export type ${singular}Input = z.infer<typeof ${schemaVarName}>;`);
  lines.push(``);

  // Parse function
  lines.push(`/**`);
  lines.push(` * Parse and validate data as a ${singular} document.`);
  lines.push(` * Throws ZodError if validation fails.`);
  lines.push(` *`);
  lines.push(` * @param data - Data to validate`);
  lines.push(` * @returns Validated ${singular} data`);
  lines.push(` */`);
  lines.push(`export function parse${singular}(data: unknown): ${singular}Input {`);
  lines.push(`  return ${schemaVarName}.parse(data);`);
  lines.push(`}`);
  lines.push(``);

  // Safe parse function
  lines.push(`/**`);
  lines.push(` * Safely parse and validate data as a ${singular} document.`);
  lines.push(` * Returns a result object instead of throwing.`);
  lines.push(` *`);
  lines.push(` * @param data - Data to validate`);
  lines.push(` * @returns Zod safe parse result`);
  lines.push(` */`);
  lines.push(`export function safeParse${singular}(data: unknown) {`);
  lines.push(`  return ${schemaVarName}.safeParse(data);`);
  lines.push(`}`);

  return lines.join('\n');
}

/**
 * ValidationGenerator produces Zod validation schema files
 * from Pocket collection schemas.
 */
export class ValidationGenerator {
  /**
   * Generate Zod validation files for a set of collections.
   *
   * For each collection, generates:
   * - A Zod schema object
   * - An inferred input type
   * - A `parse<Name>()` function (throws on invalid)
   * - A `safeParse<Name>()` function (returns result)
   *
   * @param collections - Collection schemas to generate validations for
   * @returns Array of generated files
   */
  generateValidation(collections: CollectionSchema[]): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const exportEntries: { fileName: string; names: string[] }[] = [];

    for (const collection of collections) {
      const singular = toSingular(collection.name);
      const camel = toCamelCase(collection.name);
      const fileName = `${collection.name}.validation`;

      const content = this.generateValidationFile(collection);
      files.push({
        path: `validation/${fileName}.ts`,
        content,
        type: 'validation',
      });

      exportEntries.push({
        fileName,
        names: [
          `${camel}Schema`,
          `${singular}Input`,
          `parse${singular}`,
          `safeParse${singular}`,
        ],
      });
    }

    // Generate index file
    const indexContent = this.generateValidationIndex(exportEntries);
    files.push({
      path: 'validation/index.ts',
      content: indexContent,
      type: 'index',
    });

    return files;
  }

  /**
   * Generate the validation file for a single collection.
   */
  private generateValidationFile(collection: CollectionSchema): string {
    const lines: string[] = [
      `/**`,
      ` * Auto-generated Zod validation for the "${collection.name}" collection`,
      ` *`,
      ` * DO NOT EDIT - This file is auto-generated by @pocket/codegen`,
      ` */`,
      ``,
      `import { z } from 'zod';`,
      ``,
      generateCollectionZodSchema(collection),
      ``,
    ];

    return lines.join('\n');
  }

  /**
   * Generate the index file for validation schemas.
   */
  private generateValidationIndex(
    exports: { fileName: string; names: string[] }[]
  ): string {
    const lines: string[] = [
      `/**`,
      ` * Auto-generated validation index`,
      ` *`,
      ` * DO NOT EDIT - This file is auto-generated by @pocket/codegen`,
      ` */`,
      ``,
    ];

    for (const { fileName, names } of exports) {
      lines.push(`export { ${names.join(', ')} } from './${fileName}.js';`);
    }

    lines.push(``);
    return lines.join('\n');
  }
}
