/**
 * TypedQueryGenerator — Generates type-safe query builders from collection schemas.
 *
 * @example
 * ```typescript
 * const generator = new TypedQueryGenerator();
 * const files = generator.generate({
 *   version: '1.0',
 *   collections: [{
 *     name: 'users',
 *     fields: { name: { type: 'string' }, age: { type: 'number' } },
 *   }],
 * });
 * // Generates: UsersQueryBuilder with .whereAge().gte(18) etc.
 * ```
 */

import type { CollectionSchema, GeneratedFile, PocketSchema, SchemaField } from './types.js';

// ── Types ──────────────────────────────────────────────────

export interface TypedQueryGeneratorConfig {
  /** Import path for @pocket/core (default: '@pocket/core') */
  coreImportPath?: string;
  /** Generate JSDoc comments (default: true) */
  includeJSDoc?: boolean;
  /** Prefix for generated types (default: '') */
  typePrefix?: string;
}

// ── Implementation ────────────────────────────────────────

export class TypedQueryGenerator {
  private readonly config: Required<TypedQueryGeneratorConfig>;

  constructor(config: TypedQueryGeneratorConfig = {}) {
    this.config = {
      coreImportPath: config.coreImportPath ?? '@pocket/core',
      includeJSDoc: config.includeJSDoc ?? true,
      typePrefix: config.typePrefix ?? '',
    };
  }

  /**
   * Generate type-safe query builder code for a schema.
   */
  generate(schema: PocketSchema): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    for (const collection of schema.collections) {
      files.push(this.generateCollectionTypes(collection));
      files.push(this.generateQueryBuilder(collection));
    }

    files.push(this.generateIndex(schema));
    return files;
  }

  private generateCollectionTypes(collection: CollectionSchema): GeneratedFile {
    const typeName = this.toTypeName(collection.name);
    const lines: string[] = [];

    lines.push(`// Auto-generated types for "${collection.name}" collection`);
    lines.push(`// Generated at: ${new Date().toISOString()}`);
    lines.push('');
    lines.push(`import type { Document } from '${this.config.coreImportPath}';`);
    lines.push('');

    if (this.config.includeJSDoc && collection.description) {
      lines.push(`/** ${collection.description} */`);
    }
    lines.push(`export interface ${this.config.typePrefix}${typeName} extends Document {`);

    for (const [name, field] of Object.entries(collection.fields)) {
      const tsType = this.fieldToTSType(field);
      const optional = field.required ? '' : '?';
      if (this.config.includeJSDoc && field.description) {
        lines.push(`  /** ${field.description} */`);
      }
      lines.push(`  ${name}${optional}: ${tsType};`);
    }

    if (collection.timestamps) {
      lines.push(`  createdAt: Date;`);
      lines.push(`  updatedAt: Date;`);
    }

    lines.push(`}`);
    lines.push('');

    // New document type (without _id, _rev)
    lines.push(
      `export type New${typeName} = Omit<${this.config.typePrefix}${typeName}, '_id' | '_rev'> & { _id?: string };`
    );

    return {
      path: `${collection.name}/types.ts`,
      content: lines.join('\n'),
      type: 'types',
    };
  }

  private generateQueryBuilder(collection: CollectionSchema): GeneratedFile {
    const typeName = this.toTypeName(collection.name);
    const builderName = `${typeName}QueryBuilder`;
    const lines: string[] = [];

    lines.push(`// Auto-generated query builder for "${collection.name}"`);
    lines.push('');
    lines.push(`import type { ${this.config.typePrefix}${typeName} } from './types.js';`);
    lines.push('');
    lines.push(`export interface ${builderName}Filter {`);

    for (const [name, field] of Object.entries(collection.fields)) {
      const tsType = this.fieldToTSType(field);
      lines.push(`  ${name}?: ${tsType} | ${this.getOperatorsType(field, tsType)};`);
    }

    lines.push(`}`);
    lines.push('');

    lines.push(`export interface ${builderName}Sort {`);
    for (const name of Object.keys(collection.fields)) {
      lines.push(`  ${name}?: 'asc' | 'desc';`);
    }
    lines.push(`}`);
    lines.push('');

    // Fluent query builder
    lines.push(`export class ${builderName} {`);
    lines.push(`  private _filter: ${builderName}Filter = {};`);
    lines.push(`  private _sort: ${builderName}Sort = {};`);
    lines.push(`  private _limit?: number;`);
    lines.push(`  private _skip?: number;`);
    lines.push('');

    // where methods for each field
    for (const [name, field] of Object.entries(collection.fields)) {
      const tsType = this.fieldToTSType(field);
      const capName = name.charAt(0).toUpperCase() + name.slice(1);

      lines.push(
        `  where${capName}(value: ${tsType} | ${this.getOperatorsType(field, tsType)}): this {`
      );
      lines.push(`    this._filter.${name} = value;`);
      lines.push(`    return this;`);
      lines.push(`  }`);
      lines.push('');
    }

    // sort methods
    for (const name of Object.keys(collection.fields)) {
      const capName = name.charAt(0).toUpperCase() + name.slice(1);
      lines.push(`  sortBy${capName}(direction: 'asc' | 'desc' = 'asc'): this {`);
      lines.push(`    this._sort.${name} = direction;`);
      lines.push(`    return this;`);
      lines.push(`  }`);
      lines.push('');
    }

    lines.push(`  limit(count: number): this { this._limit = count; return this; }`);
    lines.push(`  skip(count: number): this { this._skip = count; return this; }`);
    lines.push('');
    lines.push(
      `  build(): { filter: ${builderName}Filter; sort: ${builderName}Sort; limit?: number; skip?: number } {`
    );
    lines.push(
      `    return { filter: this._filter, sort: this._sort, limit: this._limit, skip: this._skip };`
    );
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
    lines.push(`export function create${builderName}(): ${builderName} {`);
    lines.push(`  return new ${builderName}();`);
    lines.push(`}`);

    return {
      path: `${collection.name}/query-builder.ts`,
      content: lines.join('\n'),
      type: 'crud',
    };
  }

  private generateIndex(schema: PocketSchema): GeneratedFile {
    const lines: string[] = [];
    lines.push('// Auto-generated index — re-exports all collections');
    lines.push('');

    for (const collection of schema.collections) {
      lines.push(`export * from './${collection.name}/types.js';`);
      lines.push(`export * from './${collection.name}/query-builder.js';`);
    }

    return { path: 'index.ts', content: lines.join('\n'), type: 'index' };
  }

  private toTypeName(name: string): string {
    return name
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private fieldToTSType(field: SchemaField): string {
    switch (field.type) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'date':
        return 'Date';
      case 'array':
        return field.items ? `${this.fieldToTSType(field.items)}[]` : 'unknown[]';
      case 'object':
        if (field.properties) {
          const props = Object.entries(field.properties)
            .map(([k, v]) => `${k}: ${this.fieldToTSType(v)}`)
            .join('; ');
          return `{ ${props} }`;
        }
        return 'Record<string, unknown>';
      case 'reference':
        return 'string';
      default:
        return 'unknown';
    }
  }

  private getOperatorsType(field: SchemaField, tsType: string): string {
    const numOps = `{ $gt?: ${tsType}; $gte?: ${tsType}; $lt?: ${tsType}; $lte?: ${tsType}; $ne?: ${tsType}; $in?: ${tsType}[] }`;
    const strOps = `{ $contains?: string; $startsWith?: string; $endsWith?: string; $ne?: string; $in?: string[] }`;

    switch (field.type) {
      case 'number':
        return numOps;
      case 'string':
        return strOps;
      case 'date':
        return numOps;
      default:
        return `{ $eq?: ${tsType}; $ne?: ${tsType} }`;
    }
  }
}

export function createTypedQueryGenerator(config?: TypedQueryGeneratorConfig): TypedQueryGenerator {
  return new TypedQueryGenerator(config);
}
