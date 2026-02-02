/**
 * @pocket/codegen - Hook Generator
 *
 * Generates typed React hooks from Pocket collection schemas.
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
 * Convert a collection name to PascalCase preserving the plural.
 */
function toPlural(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Map a SchemaFieldType to a TypeScript type string for filter types.
 */
function fieldTypeToFilterTS(field: SchemaField): string {
  switch (field.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'Date';
    case 'reference':
      return 'string';
    default:
      return 'unknown';
  }
}

/**
 * Generate a filter type interface for a collection.
 * Only includes scalar fields (string, number, boolean, date, reference)
 * since those are reasonable filter targets.
 */
function generateFilterType(collection: CollectionSchema): string {
  const interfaceName = `${toSingular(collection.name)}Filter`;
  const lines: string[] = [];

  lines.push(`/**`);
  lines.push(` * Filter type for querying ${collection.name}`);
  lines.push(` */`);
  lines.push(`export interface ${interfaceName} {`);

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    // Only include scalar types in filters
    if (['string', 'number', 'boolean', 'date', 'reference'].includes(field.type)) {
      const tsType = fieldTypeToFilterTS(field);
      lines.push(`  ${fieldName}?: ${tsType};`);
    }
  }

  lines.push(`}`);
  return lines.join('\n');
}

/**
 * Generate hooks for a single collection.
 */
function generateCollectionHooks(collection: CollectionSchema): string {
  const singular = toSingular(collection.name);
  const plural = toPlural(collection.name);
  const filterType = `${singular}Filter`;
  const collectionName = collection.name;

  const lines: string[] = [];

  // usePlural - live query for all documents
  lines.push(`/**`);
  lines.push(` * Live query hook for all documents in the "${collectionName}" collection.`);
  lines.push(` *`);
  lines.push(` * @returns Reactive array of ${singular} documents`);
  lines.push(` */`);
  lines.push(`export function use${plural}() {`);
  lines.push(`  return useLiveQuery<${singular}>('${collectionName}');`);
  lines.push(`}`);
  lines.push(``);

  // useSingular - single document by ID
  lines.push(`/**`);
  lines.push(` * Live query hook for a single ${singular} document by ID.`);
  lines.push(` *`);
  lines.push(` * @param id - Document ID to observe`);
  lines.push(` * @returns Reactive ${singular} document or null`);
  lines.push(` */`);
  lines.push(`export function use${singular}(id: string) {`);
  lines.push(`  return useDocument<${singular}>('${collectionName}', id);`);
  lines.push(`}`);
  lines.push(``);

  // useSingularMutation - typed insert/update/delete
  lines.push(`/**`);
  lines.push(` * Mutation hook for the "${collectionName}" collection.`);
  lines.push(` *`);
  lines.push(` * @returns Object with typed insert, update, and delete operations`);
  lines.push(` */`);
  lines.push(`export function use${singular}Mutation() {`);
  lines.push(`  const { db } = usePocket();`);
  lines.push(``);
  lines.push(`  return {`);
  lines.push(`    insert: async (data: Omit<${singular}, '_id' | '_rev' | '_updatedAt' | '_vclock'>) => {`);
  lines.push(`      return db.collection<${singular}>('${collectionName}').insert(data);`);
  lines.push(`    },`);
  lines.push(`    update: async (id: string, data: Partial<Omit<${singular}, '_id' | '_rev' | '_updatedAt' | '_vclock'>>) => {`);
  lines.push(`      return db.collection<${singular}>('${collectionName}').update(id, data);`);
  lines.push(`    },`);
  lines.push(`    delete: async (id: string) => {`);
  lines.push(`      return db.collection<${singular}>('${collectionName}').delete(id);`);
  lines.push(`    },`);
  lines.push(`  };`);
  lines.push(`}`);
  lines.push(``);

  // useFilteredPlural - filtered live query
  lines.push(`/**`);
  lines.push(` * Filtered live query hook for the "${collectionName}" collection.`);
  lines.push(` *`);
  lines.push(` * @param filter - Filter criteria for the query`);
  lines.push(` * @returns Reactive filtered array of ${singular} documents`);
  lines.push(` */`);
  lines.push(`export function useFiltered${plural}(filter: ${filterType}) {`);
  lines.push(`  return useLiveQuery<${singular}>('${collectionName}', { filter });`);
  lines.push(`}`);

  return lines.join('\n');
}

/**
 * HookGenerator produces typed React hook files from Pocket collection schemas.
 */
export class HookGenerator {
  /**
   * Generate React hook files for a set of collections.
   *
   * For each collection, generates:
   * - `use<Plural>()` - live query for all documents
   * - `use<Singular>(id)` - single document by ID
   * - `use<Singular>Mutation()` - typed insert/update/delete
   * - `useFiltered<Plural>(filter)` - filtered live query
   * - `<Singular>Filter` - filter type interface
   *
   * @param collections - Collection schemas to generate hooks for
   * @returns Array of generated files
   */
  generateHooks(collections: CollectionSchema[]): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const exportEntries: { fileName: string; names: string[] }[] = [];

    for (const collection of collections) {
      const singular = toSingular(collection.name);
      const plural = toPlural(collection.name);
      const fileName = `${collection.name}.hooks`;
      const filterType = `${singular}Filter`;

      const content = this.generateHookFile(collection);
      files.push({
        path: `hooks/${fileName}.ts`,
        content,
        type: 'hooks',
      });

      exportEntries.push({
        fileName,
        names: [
          `use${plural}`,
          `use${singular}`,
          `use${singular}Mutation`,
          `useFiltered${plural}`,
          filterType,
        ],
      });
    }

    // Generate index file
    const indexContent = this.generateHooksIndex(exportEntries);
    files.push({
      path: 'hooks/index.ts',
      content: indexContent,
      type: 'index',
    });

    return files;
  }

  /**
   * Generate the hook file for a single collection.
   */
  private generateHookFile(collection: CollectionSchema): string {
    const singular = toSingular(collection.name);

    const lines: string[] = [
      `/**`,
      ` * Auto-generated React hooks for the "${collection.name}" collection`,
      ` *`,
      ` * DO NOT EDIT - This file is auto-generated by @pocket/codegen`,
      ` */`,
      ``,
      `import { useLiveQuery, useDocument, usePocket } from '@pocket/react';`,
      `import type { ${singular} } from '../types/${collection.name}.types.js';`,
      ``,
      generateFilterType(collection),
      ``,
      generateCollectionHooks(collection),
      ``,
    ];

    return lines.join('\n');
  }

  /**
   * Generate the index file for hooks.
   */
  private generateHooksIndex(
    exports: { fileName: string; names: string[] }[]
  ): string {
    const lines: string[] = [
      `/**`,
      ` * Auto-generated hooks index`,
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
