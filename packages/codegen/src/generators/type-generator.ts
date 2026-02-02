/**
 * @pocket/codegen - Type Generator
 *
 * Generates TypeScript type definitions from Pocket collection schemas.
 *
 * @module @pocket/codegen
 */

import type { CollectionSchema, GeneratedFile, SchemaField } from '../types.js';

/**
 * Convert a collection name to PascalCase for use as a TypeScript interface name.
 *
 * Examples: "todos" -> "Todo", "user_profiles" -> "UserProfile", "blog-posts" -> "BlogPost"
 */
function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '');
}

/**
 * Convert a collection name to a singular form for the interface.
 * Simple heuristic: strip trailing 's' if present.
 */
function toSingular(name: string): string {
  return toPascalCase(name);
}

/**
 * Map a SchemaFieldType to a TypeScript type string.
 */
function fieldTypeToTS(field: SchemaField, indent = 2): string {
  switch (field.type) {
    case 'string':
      if (field.validation?.enum && field.validation.enum.length > 0) {
        return field.validation.enum.map((v) => JSON.stringify(v)).join(' | ');
      }
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'reference':
      return 'string';
    case 'array':
      if (field.items) {
        const itemType = fieldTypeToTS(field.items, indent);
        return `${itemType}[]`;
      }
      return 'unknown[]';
    case 'object':
      if (field.properties) {
        return generateInlineObject(field.properties, indent);
      }
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

/**
 * Generate an inline object type from nested properties.
 */
function generateInlineObject(
  properties: Record<string, SchemaField>,
  indent: number
): string {
  const spaces = ' '.repeat(indent);
  const innerSpaces = ' '.repeat(indent + 2);
  const lines: string[] = ['{'];

  for (const [propName, propField] of Object.entries(properties)) {
    const optional = propField.required ? '' : '?';
    const tsType = fieldTypeToTS(propField, indent + 2);
    const description = propField.description ? `${innerSpaces}/** ${propField.description} */\n` : '';
    lines.push(`${description}${innerSpaces}${propName}${optional}: ${tsType};`);
  }

  lines.push(`${spaces}}`);
  return lines.join('\n');
}

/**
 * Generate a TypeScript interface for a single collection.
 */
function generateInterface(collection: CollectionSchema): string {
  const interfaceName = toSingular(collection.name);
  const lines: string[] = [];

  // JSDoc comment
  if (collection.description) {
    lines.push(`/**`);
    lines.push(` * ${collection.description}`);
    lines.push(` */`);
  }

  lines.push(`export interface ${interfaceName} extends Document {`);

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    const optional = field.required ? '' : '?';
    const tsType = fieldTypeToTS(field);

    // Add field JSDoc if description present
    if (field.description) {
      lines.push(`  /** ${field.description} */`);
    }
    lines.push(`  ${fieldName}${optional}: ${tsType};`);
  }

  // Add timestamp fields if enabled
  if (collection.timestamps) {
    lines.push(`  createdAt: Date;`);
    lines.push(`  updatedAt: Date;`);
  }

  // Add soft delete field if enabled
  if (collection.softDelete) {
    lines.push(`  deletedAt?: Date;`);
  }

  lines.push(`}`);

  return lines.join('\n');
}

/**
 * TypeGenerator produces TypeScript interface definitions
 * from Pocket collection schemas.
 */
export class TypeGenerator {
  /**
   * Generate TypeScript type files for a set of collections.
   *
   * Produces one file per collection with its interface, plus a
   * collection type alias, and an index file that re-exports everything.
   *
   * @param collections - Collection schemas to generate types for
   * @returns Array of generated files
   */
  generateTypes(collections: CollectionSchema[]): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const exportNames: { fileName: string; interfaceName: string; collectionTypeName: string }[] = [];

    for (const collection of collections) {
      const interfaceName = toSingular(collection.name);
      const collectionTypeName = `${toPascalCase(collection.name)}sCollection`;
      const fileName = `${collection.name}.types`;

      const content = this.generateCollectionTypeFile(collection, interfaceName, collectionTypeName);

      files.push({
        path: `types/${fileName}.ts`,
        content,
        type: 'types',
      });

      exportNames.push({ fileName, interfaceName, collectionTypeName });
    }

    // Generate index file that re-exports all types
    const indexContent = this.generateTypesIndex(exportNames);
    files.push({
      path: 'types/index.ts',
      content: indexContent,
      type: 'index',
    });

    return files;
  }

  /**
   * Generate the type file content for a single collection.
   */
  private generateCollectionTypeFile(
    collection: CollectionSchema,
    interfaceName: string,
    collectionTypeName: string
  ): string {
    const lines: string[] = [
      `/**`,
      ` * Auto-generated types for the "${collection.name}" collection`,
      ` *`,
      ` * DO NOT EDIT - This file is auto-generated by @pocket/codegen`,
      ` */`,
      ``,
      `import type { Document } from '@pocket/core';`,
      ``,
      generateInterface(collection),
      ``,
      `/**`,
      ` * Typed collection accessor for "${collection.name}"`,
      ` */`,
      `export type ${collectionTypeName} = Collection<${interfaceName}>;`,
      ``,
    ];

    return lines.join('\n');
  }

  /**
   * Generate the index file that re-exports all collection types.
   */
  private generateTypesIndex(
    exports: { fileName: string; interfaceName: string; collectionTypeName: string }[]
  ): string {
    const lines: string[] = [
      `/**`,
      ` * Auto-generated type index`,
      ` *`,
      ` * DO NOT EDIT - This file is auto-generated by @pocket/codegen`,
      ` */`,
      ``,
    ];

    for (const { fileName, interfaceName, collectionTypeName } of exports) {
      lines.push(`export type { ${interfaceName}, ${collectionTypeName} } from './${fileName}.js';`);
    }

    lines.push(``);
    return lines.join('\n');
  }
}
