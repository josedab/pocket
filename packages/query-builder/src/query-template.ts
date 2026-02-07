/**
 * QueryTemplateRegistry - Reusable query templates with parameterization.
 *
 * Provides a registry for storing and applying parameterized query
 * templates that produce {@link VisualQueryModel} instances.
 *
 * @module query-template
 *
 * @example
 * ```typescript
 * import { createQueryTemplateRegistry } from '@pocket/query-builder';
 *
 * const registry = createQueryTemplateRegistry();
 * registry.register({
 *   name: 'activeUsers',
 *   description: 'Find active users',
 *   collection: 'users',
 *   filters: [{ field: 'status', operator: 'eq', value: 'active' }],
 *   sorts: [{ field: 'name', direction: 'asc' }],
 *   params: [],
 * });
 *
 * const model = registry.applyTemplate('activeUsers', {});
 * ```
 *
 * @see {@link VisualQueryModel}
 * @see {@link QueryTemplate}
 */

import type { SortDirection } from './types.js';
import { VisualQueryModel } from './visual-query-model.js';

/**
 * A parameter definition for a query template.
 */
export interface TemplateParam {
  /** Parameter name */
  name: string;
  /** Parameter type description */
  type: string;
  /** Human-readable description */
  description: string;
  /** Optional default value */
  defaultValue?: unknown;
}

/**
 * A reusable query template definition.
 */
export interface QueryTemplate {
  /** Unique template name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Target collection */
  collection: string;
  /** Filter conditions (values may contain `{{paramName}}` placeholders) */
  filters: Array<{ field: string; operator: string; value: unknown }>;
  /** Sort clauses */
  sorts: Array<{ field: string; direction: SortDirection }>;
  /** Template parameters */
  params: TemplateParam[];
}

/**
 * Registry for managing reusable query templates.
 *
 * @example
 * ```typescript
 * const registry = new QueryTemplateRegistry();
 *
 * // Register built-in templates
 * for (const tpl of registry.getBuiltinTemplates()) {
 *   registry.register(tpl);
 * }
 *
 * // Apply a template
 * const model = registry.applyTemplate('findById', { id: '123' });
 * ```
 *
 * @see {@link createQueryTemplateRegistry}
 */
export class QueryTemplateRegistry {
  /** @internal */
  private _templates: Map<string, QueryTemplate> = new Map();

  /**
   * Registers a reusable query template.
   *
   * @param template - The template to register
   */
  register(template: QueryTemplate): void {
    this._templates.set(template.name, template);
  }

  /**
   * Gets a template by name.
   *
   * @param name - The template name
   * @returns The template, or undefined if not found
   */
  get(name: string): QueryTemplate | undefined {
    return this._templates.get(name);
  }

  /**
   * Lists all registered templates.
   *
   * @returns An array of all templates
   */
  list(): QueryTemplate[] {
    return Array.from(this._templates.values());
  }

  /**
   * Removes a template by name.
   *
   * @param name - The template name to remove
   * @returns True if the template was removed
   */
  remove(name: string): boolean {
    return this._templates.delete(name);
  }

  /**
   * Applies a template with the given parameters, producing a {@link VisualQueryModel}.
   *
   * Parameter placeholders in filter values (strings matching `{{paramName}}`)
   * are replaced with the corresponding parameter value.
   *
   * @param name - The template name
   * @param params - Parameter values to substitute
   * @returns A VisualQueryModel configured by the template
   * @throws Error if the template is not found
   */
  applyTemplate(name: string, params: Record<string, unknown>): VisualQueryModel {
    const template = this._templates.get(name);
    if (!template) {
      throw new Error(`Template "${name}" not found`);
    }

    const collection = this._resolveValue(template.collection, params, template.params) as string;
    const model = new VisualQueryModel(collection);

    for (const filter of template.filters) {
      const field = this._resolveValue(filter.field, params, template.params) as string;
      const value = this._resolveValue(filter.value, params, template.params);
      model.addFilter(field, filter.operator, value);
    }

    for (const sort of template.sorts) {
      const sortField = this._resolveValue(sort.field, params, template.params) as string;
      model.addSort(sortField, sort.direction);
    }

    return model;
  }

  /**
   * Returns built-in common query templates.
   *
   * Includes: findById, findRecent, countByField, topN.
   *
   * @returns An array of built-in templates
   */
  getBuiltinTemplates(): QueryTemplate[] {
    return [
      {
        name: 'findById',
        description: 'Find a document by its ID',
        collection: '{{collection}}',
        filters: [{ field: 'id', operator: 'eq', value: '{{id}}' }],
        sorts: [],
        params: [
          { name: 'collection', type: 'string', description: 'The collection to query' },
          { name: 'id', type: 'string', description: 'The document ID to find' },
        ],
      },
      {
        name: 'findRecent',
        description: 'Find the most recent documents',
        collection: '{{collection}}',
        filters: [],
        sorts: [{ field: 'createdAt', direction: 'desc' }],
        params: [
          { name: 'collection', type: 'string', description: 'The collection to query' },
          { name: 'limit', type: 'number', description: 'Maximum results', defaultValue: 10 },
        ],
      },
      {
        name: 'countByField',
        description: 'Count documents matching a field value',
        collection: '{{collection}}',
        filters: [{ field: '{{field}}', operator: 'eq', value: '{{value}}' }],
        sorts: [],
        params: [
          { name: 'collection', type: 'string', description: 'The collection to query' },
          { name: 'field', type: 'string', description: 'The field to match on' },
          { name: 'value', type: 'string', description: 'The value to match' },
        ],
      },
      {
        name: 'topN',
        description: 'Find the top N documents by a field',
        collection: '{{collection}}',
        filters: [],
        sorts: [{ field: '{{sortField}}', direction: 'desc' }],
        params: [
          { name: 'collection', type: 'string', description: 'The collection to query' },
          { name: 'sortField', type: 'string', description: 'The field to sort by' },
          { name: 'limit', type: 'number', description: 'Number of results', defaultValue: 10 },
        ],
      },
    ];
  }

  /**
   * Resolves a template value by substituting parameter placeholders.
   * @internal
   */
  private _resolveValue(
    value: unknown,
    params: Record<string, unknown>,
    templateParams: TemplateParam[],
  ): unknown {
    if (typeof value === 'string') {
      // Check for exact placeholder match: "{{paramName}}"
      const exactMatch = /^\{\{(\w+)\}\}$/.exec(value);
      if (exactMatch) {
        const paramName = exactMatch[1]!;
        if (paramName in params) {
          return params[paramName];
        }
        // Fall back to default value
        const def = templateParams.find((p) => p.name === paramName);
        if (def?.defaultValue !== undefined) {
          return def.defaultValue;
        }
        return value;
      }

      // Replace inline placeholders
      return value.replace(/\{\{(\w+)\}\}/g, (_match, paramName: string) => {
        if (paramName in params) {
          return String(params[paramName]);
        }
        const def = templateParams.find((p) => p.name === paramName);
        if (def?.defaultValue !== undefined) {
          return String(def.defaultValue);
        }
        return _match;
      });
    }

    return value;
  }
}

/**
 * Creates a new {@link QueryTemplateRegistry} instance.
 *
 * @returns A new QueryTemplateRegistry
 *
 * @example
 * ```typescript
 * import { createQueryTemplateRegistry } from '@pocket/query-builder';
 *
 * const registry = createQueryTemplateRegistry();
 * ```
 */
export function createQueryTemplateRegistry(): QueryTemplateRegistry {
  return new QueryTemplateRegistry();
}
