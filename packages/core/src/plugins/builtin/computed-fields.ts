import type { Document, DocumentUpdate, NewDocument } from '../../types/document.js';
import type {
  InsertContext,
  InsertHookResult,
  PluginDefinition,
  UpdateContext,
  UpdateHookResult,
} from '../types.js';

/**
 * Computed field definition
 */
export interface ComputedField<T extends Document = Document> {
  /** Field name to compute */
  field: string;
  /** Compute function */
  compute: (doc: Partial<T>) => unknown;
  /** Fields that trigger recomputation */
  dependencies?: (keyof T)[];
  /** Whether to compute on insert */
  onInsert?: boolean;
  /** Whether to compute on update */
  onUpdate?: boolean;
}

/**
 * Computed fields plugin options
 */
export interface ComputedFieldsPluginOptions<T extends Document = Document> {
  /** Collection to apply to */
  collection: string;
  /** Computed field definitions */
  fields: ComputedField<T>[];
}

/**
 * Create a computed fields plugin
 */
export function createComputedFieldsPlugin<T extends Document = Document>(
  options: ComputedFieldsPluginOptions<T>
): PluginDefinition<T> {
  const { collection, fields } = options;

  const computeFields = (
    doc: Partial<T>,
    changedFields?: Set<string>,
    isInsert = false
  ): Partial<T> => {
    const result = { ...doc } as Record<string, unknown>;

    for (const field of fields) {
      // Check if we should compute
      const shouldCompute =
        (isInsert && (field.onInsert ?? true)) || (!isInsert && (field.onUpdate ?? true));

      if (!shouldCompute) continue;

      // Check dependencies
      if (!isInsert && changedFields && field.dependencies) {
        const hasDependencyChange = field.dependencies.some((dep) =>
          changedFields.has(dep as string)
        );
        if (!hasDependencyChange) continue;
      }

      // Compute the field
      result[field.field] = field.compute(doc);
    }

    return result as Partial<T>;
  };

  return {
    name: `computed-fields-${collection}`,
    version: '1.0.0',
    priority: 100, // Run early to compute before other plugins

    beforeInsert: (context: InsertContext<T>): InsertHookResult<T> => {
      if (context.collection !== collection) return {};

      const computedDoc = computeFields(context.document as Partial<T>, undefined, true);
      return { document: computedDoc as NewDocument<T> };
    },

    beforeUpdate: (context: UpdateContext<T>): UpdateHookResult<T> => {
      if (context.collection !== collection) return {};

      const changedFields = new Set(Object.keys(context.changes));
      const merged = { ...context.existingDocument, ...context.changes } as Partial<T>;
      const computedDoc = computeFields(merged, changedFields, false);

      // Only return the changed fields plus computed fields
      const newChanges = { ...context.changes } as Record<string, unknown>;
      for (const field of fields) {
        if (field.field in computedDoc) {
          newChanges[field.field] = computedDoc[field.field as keyof Partial<T>];
        }
      }

      return { changes: newChanges as DocumentUpdate<T> };
    },
  };
}

/**
 * Common computed field helpers
 */
export const ComputedFieldHelpers = {
  /**
   * Create a full name computed field from first and last name
   */
  fullName: <
    T extends Document & { firstName?: string; lastName?: string },
  >(): ComputedField<T> => ({
    field: 'fullName',
    dependencies: ['firstName', 'lastName'],
    compute: (doc) => {
      const parts = [doc.firstName, doc.lastName].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : undefined;
    },
  }),

  /**
   * Create a slug computed field from a source field
   */
  slug: <T extends Document>(sourceField: keyof T): ComputedField<T> => ({
    field: 'slug',
    dependencies: [sourceField],
    compute: (doc) => {
      const value = doc[sourceField];
      if (typeof value !== 'string') return undefined;
      return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    },
  }),

  /**
   * Create an updatedAt timestamp field
   */
  updatedAt: <T extends Document>(): ComputedField<T> => ({
    field: 'updatedAt',
    compute: () => Date.now(),
    onInsert: true,
    onUpdate: true,
  }),

  /**
   * Create a word count computed field
   */
  wordCount: <T extends Document>(sourceField: keyof T): ComputedField<T> => ({
    field: 'wordCount',
    dependencies: [sourceField],
    compute: (doc) => {
      const value = doc[sourceField];
      if (typeof value !== 'string') return 0;
      return value.trim().split(/\s+/).filter(Boolean).length;
    },
  }),

  /**
   * Create a character count computed field
   */
  characterCount: <T extends Document>(sourceField: keyof T): ComputedField<T> => ({
    field: 'characterCount',
    dependencies: [sourceField],
    compute: (doc) => {
      const value = doc[sourceField];
      if (typeof value !== 'string') return 0;
      return value.length;
    },
  }),
};
