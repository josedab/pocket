/**
 * Schema Designer — visual schema design and management for Pocket Studio.
 *
 * Provides schema inference from existing data, schema editing, validation,
 * relationship mapping, and schema-to-code export.
 */

export interface SchemaFieldInfo {
  name: string;
  type: string;
  required: boolean;
  indexed: boolean;
  unique: boolean;
  description?: string;
  defaultValue?: unknown;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: unknown[];
  };
}

export interface SchemaRelationship {
  name: string;
  fromCollection: string;
  fromField: string;
  toCollection: string;
  toField: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

export interface CollectionSchemaInfo {
  name: string;
  fields: SchemaFieldInfo[];
  relationships: SchemaRelationship[];
  documentCount: number;
  timestamps: boolean;
  softDelete: boolean;
}

export interface SchemaDesignerConfig {
  /** Maximum documents to sample for schema inference (default: 100) */
  sampleSize?: number;
}

export interface SchemaValidationIssue {
  collection: string;
  field?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface DatabaseLike {
  collection(name: string): CollectionLike;
}

export interface CollectionLike {
  find(options?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

/**
 * Infers and manages schema information for Pocket collections.
 */
export class SchemaDesigner {
  private readonly config: Required<SchemaDesignerConfig>;
  private readonly schemas = new Map<string, CollectionSchemaInfo>();

  constructor(config: SchemaDesignerConfig = {}) {
    this.config = {
      sampleSize: config.sampleSize ?? 100,
    };
  }

  /**
   * Infer the schema of a collection by sampling documents.
   */
  async inferSchema(
    collectionName: string,
    documents: Record<string, unknown>[],
  ): Promise<CollectionSchemaInfo> {
    const fieldMap = new Map<string, { types: Set<string>; count: number; total: number }>();
    const sample = documents.slice(0, this.config.sampleSize);

    for (const doc of sample) {
      for (const [key, value] of Object.entries(doc)) {
        if (key.startsWith('_') && key !== '_id') continue;

        if (!fieldMap.has(key)) {
          fieldMap.set(key, { types: new Set(), count: 0, total: sample.length });
        }
        const entry = fieldMap.get(key)!;
        entry.types.add(inferType(value));
        entry.count++;
      }
    }

    const fields: SchemaFieldInfo[] = [];
    for (const [name, info] of fieldMap) {
      if (name === '_id') continue;

      fields.push({
        name,
        type: info.types.size === 1 ? [...info.types][0]! : 'mixed',
        required: info.count === info.total,
        indexed: false,
        unique: false,
      });
    }

    const schema: CollectionSchemaInfo = {
      name: collectionName,
      fields,
      relationships: [],
      documentCount: documents.length,
      timestamps: fieldMap.has('createdAt') || fieldMap.has('_createdAt'),
      softDelete: fieldMap.has('_deleted') || fieldMap.has('deletedAt'),
    };

    this.schemas.set(collectionName, schema);
    return schema;
  }

  /**
   * Add a field to a collection schema.
   */
  addField(collection: string, field: SchemaFieldInfo): boolean {
    const schema = this.schemas.get(collection);
    if (!schema) return false;
    if (schema.fields.some((f) => f.name === field.name)) return false;
    schema.fields.push(field);
    return true;
  }

  /**
   * Remove a field from a collection schema.
   */
  removeField(collection: string, fieldName: string): boolean {
    const schema = this.schemas.get(collection);
    if (!schema) return false;
    const idx = schema.fields.findIndex((f) => f.name === fieldName);
    if (idx === -1) return false;
    schema.fields.splice(idx, 1);
    return true;
  }

  /**
   * Add a relationship between collections.
   */
  addRelationship(relationship: SchemaRelationship): void {
    const schema = this.schemas.get(relationship.fromCollection);
    if (schema) {
      schema.relationships.push(relationship);
    }
  }

  /**
   * Validate all schemas and return issues.
   */
  validate(): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];

    for (const [name, schema] of this.schemas) {
      if (schema.fields.length === 0) {
        issues.push({
          collection: name,
          severity: 'warning',
          message: 'Collection has no fields defined',
        });
      }

      const fieldNames = new Set<string>();
      for (const field of schema.fields) {
        if (fieldNames.has(field.name)) {
          issues.push({
            collection: name,
            field: field.name,
            severity: 'error',
            message: `Duplicate field name: ${field.name}`,
          });
        }
        fieldNames.add(field.name);

        if (field.type === 'mixed') {
          issues.push({
            collection: name,
            field: field.name,
            severity: 'warning',
            message: `Field has inconsistent types across documents`,
          });
        }
      }

      // Validate relationships
      for (const rel of schema.relationships) {
        if (!this.schemas.has(rel.toCollection)) {
          issues.push({
            collection: name,
            severity: 'error',
            message: `Relationship "${rel.name}" references unknown collection "${rel.toCollection}"`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Export schema as a Pocket schema definition.
   */
  exportSchema(collection: string): Record<string, unknown> | undefined {
    const schema = this.schemas.get(collection);
    if (!schema) return undefined;

    const fields: Record<string, unknown> = {};
    for (const field of schema.fields) {
      fields[field.name] = {
        type: field.type,
        required: field.required,
        indexed: field.indexed || undefined,
        unique: field.unique || undefined,
        description: field.description,
        default: field.defaultValue,
        validation: field.validation,
      };
    }

    return {
      name: schema.name,
      fields,
      timestamps: schema.timestamps,
      softDelete: schema.softDelete,
    };
  }

  /**
   * Get schema for a collection.
   */
  getSchema(collection: string): CollectionSchemaInfo | undefined {
    return this.schemas.get(collection);
  }

  /**
   * Get all collection schemas.
   */
  getAllSchemas(): CollectionSchemaInfo[] {
    return Array.from(this.schemas.values());
  }

  /**
   * Clear all schemas.
   */
  clear(): void {
    this.schemas.clear();
  }
}

function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

/**
 * Create a SchemaDesigner instance.
 */
export function createSchemaDesigner(config?: SchemaDesignerConfig): SchemaDesigner {
  return new SchemaDesigner(config);
}
