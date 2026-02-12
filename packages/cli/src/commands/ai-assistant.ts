/**
 * AI Assistant command for the Pocket CLI.
 *
 * Provides AI-powered schema analysis, query generation, index recommendations,
 * and migration suggestions. Works with local LLMs or cloud providers.
 *
 * @module @pocket/cli
 */

import type { PocketConfig, CollectionConfig, SchemaFieldDef } from '../config/types.js';

// ── Types ─────────────────────────────────────────────────

export type AIProvider = 'local' | 'openai' | 'anthropic';

export interface AIAssistantConfig {
  /** AI provider to use (default: 'local') */
  provider?: AIProvider;
  /** API key for cloud providers */
  apiKey?: string;
  /** Model name override */
  model?: string;
  /** Maximum tokens in response (default: 2048) */
  maxTokens?: number;
  /** Temperature for generation (default: 0.3) */
  temperature?: number;
}

export interface SchemaAnalysis {
  collectionName: string;
  fieldCount: number;
  fields: FieldAnalysis[];
  suggestions: string[];
  relationships: RelationshipSuggestion[];
  estimatedDocSize: number;
}

export interface FieldAnalysis {
  name: string;
  type: string;
  required: boolean;
  hasDefault: boolean;
  issues: string[];
}

export interface RelationshipSuggestion {
  from: string;
  to: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  field: string;
  reason: string;
}

export interface IndexRecommendation {
  collection: string;
  fields: string[];
  unique: boolean;
  reason: string;
  estimatedImpact: 'low' | 'medium' | 'high';
}

export interface QuerySuggestion {
  description: string;
  code: string;
  explanation: string;
}

export interface MigrationSuggestion {
  name: string;
  description: string;
  operations: MigrationOperation[];
  risk: 'low' | 'medium' | 'high';
}

export interface MigrationOperation {
  type: 'add-field' | 'remove-field' | 'add-index' | 'rename-field' | 'change-type';
  collection: string;
  field?: string;
  details: string;
}

// ── Schema Analyzer ───────────────────────────────────────

const TYPE_SIZES: Record<string, number> = {
  string: 64,
  number: 8,
  boolean: 1,
  date: 8,
  object: 256,
  array: 128,
};

/**
 * Analyze a Pocket configuration and provide AI-powered insights.
 *
 * Examines collection schemas, detects relationships, suggests indexes,
 * and identifies common anti-patterns.
 */
export class AIAssistant {
  /** Current assistant configuration */
  readonly provider: AIProvider;
  readonly model: string;

  constructor(aiConfig?: AIAssistantConfig) {
    this.provider = aiConfig?.provider ?? 'local';
    this.model = aiConfig?.model ?? 'auto';
  }

  /** Analyze all collections in a Pocket config */
  analyzeSchema(pocketConfig: PocketConfig): SchemaAnalysis[] {
    const collections = pocketConfig.collections ?? {};
    return Object.entries(collections).map(([name, col]) =>
      this.analyzeCollection(name, col)
    );
  }

  /** Analyze a single collection */
  analyzeCollection(name: string, collection: CollectionConfig): SchemaAnalysis {
    const properties = collection.schema?.properties ?? {};
    const fields = Object.entries(properties).map(([fieldName, def]) =>
      this.analyzeField(fieldName, def)
    );

    const suggestions = this.generateSuggestions(name, collection, fields);
    const relationships = this.detectRelationships(name, properties);
    const estimatedDocSize = fields.reduce(
      (sum, f) => sum + (TYPE_SIZES[f.type] ?? 64),
      16 // overhead for document ID + metadata
    );

    return {
      collectionName: name,
      fieldCount: fields.length,
      fields,
      suggestions,
      relationships,
      estimatedDocSize,
    };
  }

  /** Generate index recommendations based on schema analysis */
  recommendIndexes(pocketConfig: PocketConfig): IndexRecommendation[] {
    const recommendations: IndexRecommendation[] = [];
    const collections = pocketConfig.collections ?? {};

    for (const [name, col] of Object.entries(collections)) {
      const properties = col.schema?.properties ?? {};
      const existingIndexFields = new Set(
        (col.indexes ?? []).flatMap((idx) => idx.fields)
      );

      // Recommend index for ref fields (foreign keys)
      for (const [field, def] of Object.entries(properties)) {
        if (def.ref && !existingIndexFields.has(field)) {
          recommendations.push({
            collection: name,
            fields: [field],
            unique: false,
            reason: `Foreign key to '${def.ref}' — index speeds up joins and lookups`,
            estimatedImpact: 'high',
          });
        }
      }

      // Recommend unique index for email-like fields
      for (const [field, def] of Object.entries(properties)) {
        if (
          def.type === 'string' &&
          (field === 'email' || field === 'slug' || field === 'username') &&
          !existingIndexFields.has(field)
        ) {
          recommendations.push({
            collection: name,
            fields: [field],
            unique: true,
            reason: `'${field}' appears to be a unique identifier — unique index prevents duplicates`,
            estimatedImpact: 'high',
          });
        }
      }

      // Recommend index for TTL fields
      if (col.ttl && !existingIndexFields.has(col.ttl.field)) {
        recommendations.push({
          collection: name,
          fields: [col.ttl.field],
          unique: false,
          reason: `TTL field '${col.ttl.field}' needs an index for efficient expiration queries`,
          estimatedImpact: 'medium',
        });
      }

      // Recommend compound index if collection has multiple filterable fields
      const filterableFields = Object.entries(properties)
        .filter(([_, def]) => def.type === 'string' || def.type === 'number' || def.type === 'boolean')
        .map(([field]) => field)
        .filter((field) => !existingIndexFields.has(field));

      if (filterableFields.length >= 2 && filterableFields.length <= 4) {
        recommendations.push({
          collection: name,
          fields: filterableFields.slice(0, 3),
          unique: false,
          reason: `Compound index on frequently filtered fields improves query performance`,
          estimatedImpact: 'medium',
        });
      }
    }

    return recommendations;
  }

  /** Generate a Pocket query from natural language */
  generateQuery(naturalLanguage: string, pocketConfig: PocketConfig): QuerySuggestion[] {
    const collections = pocketConfig.collections ?? {};
    const suggestions: QuerySuggestion[] = [];
    const lower = naturalLanguage.toLowerCase();

    // Pattern matching for common query shapes
    for (const [name, col] of Object.entries(collections)) {
      const properties = col.schema?.properties ?? {};
      const fields = Object.keys(properties);

      // "find all X" → select all from collection
      if (lower.includes(`all ${name}`) || lower.includes(`every ${name}`)) {
        suggestions.push({
          description: `Find all documents in ${name}`,
          code: `db.collection('${name}').find().exec()`,
          explanation: `Retrieves every document from the '${name}' collection.`,
        });
      }

      // "find X where/with Y" → filtered query
      for (const field of fields) {
        if (lower.includes(field)) {
          const def = properties[field];
          if (def?.type === 'string') {
            suggestions.push({
              description: `Find ${name} by ${field}`,
              code: `db.collection('${name}').find({ selector: { ${field}: { $eq: '<value>' } } }).exec()`,
              explanation: `Filters '${name}' where '${field}' equals the given value.`,
            });
          } else if (def?.type === 'number') {
            suggestions.push({
              description: `Find ${name} by ${field} range`,
              code: `db.collection('${name}').find({ selector: { ${field}: { $gte: 0, $lte: 100 } } }).exec()`,
              explanation: `Filters '${name}' where '${field}' falls within a numeric range.`,
            });
          } else if (def?.type === 'boolean') {
            suggestions.push({
              description: `Find ${name} where ${field} is true`,
              code: `db.collection('${name}').find({ selector: { ${field}: { $eq: true } } }).exec()`,
              explanation: `Filters '${name}' where '${field}' is true.`,
            });
          }
        }
      }

      // "count X" → aggregation
      if (lower.includes(`count ${name}`) || lower.includes(`how many ${name}`)) {
        suggestions.push({
          description: `Count documents in ${name}`,
          code: `const docs = await db.collection('${name}').find().exec();\nconst count = docs.length;`,
          explanation: `Counts all documents in the '${name}' collection.`,
        });
      }

      // "sort/order by" → sorted query
      for (const field of fields) {
        if (lower.includes('sort') && lower.includes(field)) {
          suggestions.push({
            description: `Sort ${name} by ${field}`,
            code: `db.collection('${name}').find({ sort: [{ ${field}: 'asc' }] }).exec()`,
            explanation: `Retrieves '${name}' sorted by '${field}' in ascending order.`,
          });
        }
      }
    }

    if (suggestions.length === 0) {
      suggestions.push({
        description: 'Generic query template',
        code: `db.collection('<collection>').find({ selector: { /* conditions */ }, sort: [{ /* field: 'asc' */ }], limit: 10 }).exec()`,
        explanation: `Template for querying any collection. Replace placeholders with your collection name and conditions.`,
      });
    }

    return suggestions;
  }

  /** Suggest schema migrations based on best practices */
  suggestMigrations(pocketConfig: PocketConfig): MigrationSuggestion[] {
    const suggestions: MigrationSuggestion[] = [];
    const collections = pocketConfig.collections ?? {};

    for (const [name, col] of Object.entries(collections)) {
      const properties = col.schema?.properties ?? {};

      // Suggest adding timestamps if missing
      const hasCreatedAt = 'createdAt' in properties || 'created_at' in properties;
      const hasUpdatedAt = 'updatedAt' in properties || 'updated_at' in properties;

      if (!hasCreatedAt || !hasUpdatedAt) {
        const ops: MigrationOperation[] = [];
        if (!hasCreatedAt) {
          ops.push({
            type: 'add-field',
            collection: name,
            field: 'createdAt',
            details: 'Add createdAt timestamp field with default Date.now()',
          });
        }
        if (!hasUpdatedAt) {
          ops.push({
            type: 'add-field',
            collection: name,
            field: 'updatedAt',
            details: 'Add updatedAt timestamp field with auto-update on change',
          });
        }
        suggestions.push({
          name: `add-timestamps-to-${name}`,
          description: `Add automatic timestamp fields to ${name}`,
          operations: ops,
          risk: 'low',
        });
      }

      // Suggest soft delete if not present
      const hasSoftDelete = 'deletedAt' in properties || 'deleted_at' in properties || 'isDeleted' in properties;
      if (!hasSoftDelete) {
        suggestions.push({
          name: `add-soft-delete-to-${name}`,
          description: `Add soft delete support to ${name} (preserves data, enables undo)`,
          operations: [{
            type: 'add-field',
            collection: name,
            field: 'deletedAt',
            details: 'Add nullable deletedAt field; non-null means soft-deleted',
          }],
          risk: 'low',
        });
      }

      // Suggest adding indexes for required string fields
      const existingIndexFields = new Set(
        (col.indexes ?? []).flatMap((idx) => idx.fields)
      );
      for (const [field, def] of Object.entries(properties)) {
        if (def.required && def.type === 'string' && !existingIndexFields.has(field)) {
          suggestions.push({
            name: `add-index-${name}-${field}`,
            description: `Add index on required field '${field}' in ${name}`,
            operations: [{
              type: 'add-index',
              collection: name,
              field,
              details: `Create index on '${field}' for faster queries`,
            }],
            risk: 'low',
          });
        }
      }
    }

    return suggestions;
  }

  // ── Private helpers ───────────────────────────────────

  private analyzeField(name: string, def: SchemaFieldDef): FieldAnalysis {
    const issues: string[] = [];

    if (!def.required && def.default === undefined) {
      issues.push(`Optional field '${name}' has no default — may cause undefined at runtime`);
    }

    if (def.type === 'string' && name.toLowerCase().includes('password')) {
      issues.push(`Field '${name}' may contain sensitive data — consider encryption`);
    }

    if (def.type === 'string' && (name === 'id' || name === '_id')) {
      issues.push(`Field '${name}' shadows the document ID — use a different name`);
    }

    if (def.type === 'array' && !def.ref) {
      issues.push(`Array field '${name}' without ref — consider normalizing into a separate collection`);
    }

    return {
      name,
      type: def.type,
      required: def.required ?? false,
      hasDefault: def.default !== undefined,
      issues,
    };
  }

  private generateSuggestions(
    name: string,
    collection: CollectionConfig,
    fields: FieldAnalysis[],
  ): string[] {
    const suggestions: string[] = [];

    if (fields.length === 0) {
      suggestions.push(`Collection '${name}' has no schema — define properties for type safety`);
    }

    if (fields.length > 20) {
      suggestions.push(`Collection '${name}' has ${fields.length} fields — consider splitting into related collections`);
    }

    const requiredCount = fields.filter((f) => f.required).length;
    if (requiredCount === 0 && fields.length > 0) {
      suggestions.push(`No required fields in '${name}' — consider marking key fields as required`);
    }

    if (!collection.indexes?.length && fields.length > 3) {
      suggestions.push(`No indexes defined for '${name}' — add indexes on frequently queried fields`);
    }

    if (collection.sync === undefined) {
      suggestions.push(`Sync not configured for '${name}' — explicitly set sync: true/false`);
    }

    const issueCount = fields.reduce((sum, f) => sum + f.issues.length, 0);
    if (issueCount > 0) {
      suggestions.push(`${issueCount} field-level issue(s) detected — review field analyses`);
    }

    return suggestions;
  }

  private detectRelationships(
    collectionName: string,
    properties: Record<string, SchemaFieldDef>,
  ): RelationshipSuggestion[] {
    const relationships: RelationshipSuggestion[] = [];

    for (const [field, def] of Object.entries(properties)) {
      if (def.ref) {
        relationships.push({
          from: collectionName,
          to: def.ref,
          type: def.type === 'array' ? 'one-to-many' : 'one-to-one',
          field,
          reason: `Explicit ref to '${def.ref}' collection`,
        });
      }

      // Heuristic: field named "<collection>Id" implies a relationship
      if (field.endsWith('Id') && !def.ref) {
        const targetCollection = field.slice(0, -2);
        relationships.push({
          from: collectionName,
          to: targetCollection,
          type: 'one-to-one',
          field,
          reason: `Naming convention suggests foreign key to '${targetCollection}'`,
        });
      }
    }

    return relationships;
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a new AI assistant for schema analysis and query generation */
export function createAIAssistant(config?: AIAssistantConfig): AIAssistant {
  return new AIAssistant(config);
}
