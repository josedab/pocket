/**
 * Schema Design Engine — models collection schemas with fields,
 * relationships, indexes, and validation rules. Generates TypeScript
 * interfaces, Zod schemas, and migration scripts.
 */

/** Supported field types in the schema design engine. */
export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'array'
  | 'object'
  | 'enum'
  | 'reference';

/** A field definition within a collection schema. */
export interface FieldDefinition {
  readonly name: string;
  readonly type: SchemaFieldType;
  readonly required: boolean;
  readonly description?: string;
  readonly defaultValue?: unknown;
  /** For enum types, the allowed values. */
  readonly enumValues?: readonly string[];
  /** For reference types, the target collection. */
  readonly referenceCollection?: string;
  /** For array types, the element type. */
  readonly arrayItemType?: SchemaFieldType;
  /** Validation constraints. */
  readonly validation?: FieldValidation;
  /** Whether to create an index on this field. */
  readonly indexed?: boolean;
}

/** Validation constraints for a field. */
export interface FieldValidation {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly unique?: boolean;
}

/** An index definition. */
export interface IndexDefinition {
  readonly name: string;
  readonly fields: readonly string[];
  readonly unique?: boolean;
}

/** Relationship between collections. */
export interface RelationshipDefinition {
  readonly name: string;
  readonly sourceCollection: string;
  readonly sourceField: string;
  readonly targetCollection: string;
  readonly targetField: string;
  readonly type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

/** Complete collection schema. */
export interface CollectionSchema {
  readonly name: string;
  readonly description?: string;
  readonly fields: readonly FieldDefinition[];
  readonly indexes: readonly IndexDefinition[];
  readonly timestamps?: boolean;
  readonly softDelete?: boolean;
}

/** Complete database schema (all collections + relationships). */
export interface DatabaseSchema {
  readonly version: number;
  readonly collections: readonly CollectionSchema[];
  readonly relationships: readonly RelationshipDefinition[];
}

/** A diff between two schema versions. */
export interface SchemaDiff {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changes: readonly SchemaChange[];
}

/** A single schema change. */
export interface SchemaChange {
  readonly type:
    | 'add-collection'
    | 'remove-collection'
    | 'add-field'
    | 'remove-field'
    | 'modify-field'
    | 'add-index'
    | 'remove-index'
    | 'add-relationship'
    | 'remove-relationship';
  readonly collection?: string;
  readonly field?: string;
  readonly details: string;
  readonly breaking: boolean;
}

// ─── Schema Design Engine ────────────────────────────────────────

export class SchemaDesignEngine {
  private collections = new Map<string, CollectionSchema>();
  private relationships: RelationshipDefinition[] = [];
  private version = 1;

  /** Add a new collection. */
  addCollection(schema: CollectionSchema): void {
    this.collections.set(schema.name, schema);
  }

  /** Remove a collection. */
  removeCollection(name: string): void {
    this.collections.delete(name);
    this.relationships = this.relationships.filter(
      (r) => r.sourceCollection !== name && r.targetCollection !== name
    );
  }

  /** Add a field to a collection. */
  addField(collection: string, field: FieldDefinition): void {
    const schema = this.collections.get(collection);
    if (!schema) return;
    this.collections.set(collection, {
      ...schema,
      fields: [...schema.fields, field],
    });
  }

  /** Remove a field from a collection. */
  removeField(collection: string, fieldName: string): void {
    const schema = this.collections.get(collection);
    if (!schema) return;
    this.collections.set(collection, {
      ...schema,
      fields: schema.fields.filter((f) => f.name !== fieldName),
    });
  }

  /** Add a relationship between collections. */
  addRelationship(rel: RelationshipDefinition): void {
    this.relationships.push(rel);
  }

  /** Add an index to a collection. */
  addIndex(collection: string, index: IndexDefinition): void {
    const schema = this.collections.get(collection);
    if (!schema) return;
    this.collections.set(collection, {
      ...schema,
      indexes: [...schema.indexes, index],
    });
  }

  /** Get the current database schema. */
  getSchema(): DatabaseSchema {
    return {
      version: this.version,
      collections: Array.from(this.collections.values()),
      relationships: [...this.relationships],
    };
  }

  /** Load a schema (e.g., from saved state). */
  loadSchema(schema: DatabaseSchema): void {
    this.collections.clear();
    for (const col of schema.collections) {
      this.collections.set(col.name, col);
    }
    this.relationships = [...schema.relationships];
    this.version = schema.version;
  }

  /** Increment version. */
  bumpVersion(): number {
    return ++this.version;
  }

  /** Compute the diff between two schemas. */
  static diff(from: DatabaseSchema, to: DatabaseSchema): SchemaDiff {
    const changes: SchemaChange[] = [];

    const fromCols = new Map(from.collections.map((c) => [c.name, c]));
    const toCols = new Map(to.collections.map((c) => [c.name, c]));

    // Added collections
    for (const [name] of toCols) {
      if (!fromCols.has(name)) {
        changes.push({
          type: 'add-collection',
          collection: name,
          details: `Add collection "${name}"`,
          breaking: false,
        });
      }
    }

    // Removed collections
    for (const [name] of fromCols) {
      if (!toCols.has(name)) {
        changes.push({
          type: 'remove-collection',
          collection: name,
          details: `Remove collection "${name}"`,
          breaking: true,
        });
      }
    }

    // Field changes
    for (const [name, toCol] of toCols) {
      const fromCol = fromCols.get(name);
      if (!fromCol) continue;

      const fromFields = new Map(fromCol.fields.map((f) => [f.name, f]));
      const toFields = new Map(toCol.fields.map((f) => [f.name, f]));

      for (const [fieldName] of toFields) {
        if (!fromFields.has(fieldName)) {
          changes.push({
            type: 'add-field',
            collection: name,
            field: fieldName,
            details: `Add field "${fieldName}" to "${name}"`,
            breaking: false,
          });
        }
      }

      for (const [fieldName] of fromFields) {
        if (!toFields.has(fieldName)) {
          changes.push({
            type: 'remove-field',
            collection: name,
            field: fieldName,
            details: `Remove field "${fieldName}" from "${name}"`,
            breaking: true,
          });
        }
      }

      for (const [fieldName, toField] of toFields) {
        const fromField = fromFields.get(fieldName);
        if (!fromField) continue;
        if (fromField.type !== toField.type || fromField.required !== toField.required) {
          changes.push({
            type: 'modify-field',
            collection: name,
            field: fieldName,
            details: `Modify "${fieldName}" in "${name}": ${fromField.type}→${toField.type}`,
            breaking: fromField.type !== toField.type,
          });
        }
      }
    }

    return { fromVersion: from.version, toVersion: to.version, changes };
  }

  // ─── Code Generation ────────────────────────────────────────

  /** Generate TypeScript interfaces for all collections. */
  generateTypeScript(): string {
    const lines: string[] = ['// Auto-generated by @pocket/studio Schema Designer', ''];

    for (const col of this.collections.values()) {
      lines.push(`export interface ${pascalCase(col.name)} {`);
      lines.push(`  _id: string;`);

      for (const field of col.fields) {
        const optional = field.required ? '' : '?';
        const tsType = fieldTypeToTS(field);
        lines.push(`  ${field.name}${optional}: ${tsType};`);
      }

      if (col.timestamps) {
        lines.push('  _createdAt: Date;');
        lines.push('  _updatedAt: Date;');
      }
      if (col.softDelete) {
        lines.push('  _deleted?: boolean;');
      }

      lines.push('}');
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Generate Zod schemas for all collections. */
  generateZodSchemas(): string {
    const lines: string[] = [
      '// Auto-generated by @pocket/studio Schema Designer',
      "import { z } from 'zod';",
      '',
    ];

    for (const col of this.collections.values()) {
      lines.push(`export const ${camelCase(col.name)}Schema = z.object({`);
      lines.push('  _id: z.string(),');

      for (const field of col.fields) {
        const zodType = fieldTypeToZod(field);
        lines.push(`  ${field.name}: ${zodType},`);
      }

      lines.push('});');
      lines.push(
        `export type ${pascalCase(col.name)} = z.infer<typeof ${camelCase(col.name)}Schema>;`
      );
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Generate a migration script from a schema diff. */
  static generateMigration(diff: SchemaDiff): string {
    const lines: string[] = [
      `// Migration: v${diff.fromVersion} → v${diff.toVersion}`,
      `// Auto-generated by @pocket/studio Schema Designer`,
      '',
      `export const migration = {`,
      `  version: ${diff.toVersion},`,
      `  async up(db) {`,
    ];

    for (const change of diff.changes) {
      switch (change.type) {
        case 'add-collection':
          lines.push(`    // ${change.details}`);
          lines.push(`    await db.createCollection('${change.collection}');`);
          break;
        case 'remove-collection':
          lines.push(`    // ${change.details} [BREAKING]`);
          lines.push(`    await db.dropCollection('${change.collection}');`);
          break;
        case 'add-field':
          lines.push(`    // ${change.details}`);
          lines.push(
            `    await db.collection('${change.collection}').addField('${change.field}');`
          );
          break;
        case 'remove-field':
          lines.push(`    // ${change.details} [BREAKING]`);
          lines.push(
            `    await db.collection('${change.collection}').removeField('${change.field}');`
          );
          break;
        case 'add-index':
          lines.push(`    // ${change.details}`);
          lines.push(
            `    await db.collection('${change.collection}').createIndex('${change.field}');`
          );
          break;
        default:
          lines.push(`    // ${change.details}`);
      }
    }

    lines.push('  },');
    lines.push('};');
    return lines.join('\n');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function pascalCase(str: string): string {
  return str.replace(/(^|[-_\s])(\w)/g, (_, _sep, c: string) => c.toUpperCase());
}

function camelCase(str: string): string {
  const pc = pascalCase(str);
  return pc.charAt(0).toLowerCase() + pc.slice(1);
}

function fieldTypeToTS(field: FieldDefinition): string {
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
      return `${fieldTypeToTS({ ...field, type: field.arrayItemType ?? 'string' } as FieldDefinition)}[]`;
    case 'object':
      return 'Record<string, unknown>';
    case 'enum':
      return field.enumValues?.map((v) => `'${v}'`).join(' | ') ?? 'string';
    case 'reference':
      return 'string';
    default:
      return 'unknown';
  }
}

function fieldTypeToZod(field: FieldDefinition): string {
  let base: string;
  switch (field.type) {
    case 'string':
      base = 'z.string()';
      break;
    case 'number':
      base = 'z.number()';
      break;
    case 'boolean':
      base = 'z.boolean()';
      break;
    case 'date':
      base = 'z.date()';
      break;
    case 'array':
      base = 'z.array(z.unknown())';
      break;
    case 'object':
      base = 'z.record(z.unknown())';
      break;
    case 'enum':
      base = `z.enum([${(field.enumValues ?? []).map((v) => `'${v}'`).join(', ')}])`;
      break;
    case 'reference':
      base = 'z.string()';
      break;
    default:
      base = 'z.unknown()';
  }
  if (!field.required) base += '.optional()';
  return base;
}

export function createSchemaDesignEngine(): SchemaDesignEngine {
  return new SchemaDesignEngine();
}
