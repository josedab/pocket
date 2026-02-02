/**
 * Filter Generator — creates GraphQL input types for complex
 * filtering, ordering, and cursor-based pagination.
 *
 * Operators are mapped per field type so only semantically valid
 * comparisons are exposed in the schema.
 *
 * @example
 * ```typescript
 * import { createFilterGenerator } from '@pocket/graphql';
 *
 * const generator = createFilterGenerator();
 * const { typeDefs, buildFilter } = generator.generate({
 *   collections: [{ name: 'todos', fields: { title: { type: 'string' } } }],
 * });
 *
 * // Convert a client-supplied WhereInput into a Pocket query filter
 * const filter = buildFilter({ title: { contains: 'ship' } });
 * ```
 *
 * @module @pocket/graphql/filter-generator
 */

import type { CollectionDefinition, FieldDefinition, GraphQLFieldType } from './types.js';

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/** Supported filter operators. */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'nin'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull';

/** Options accepted by {@link FilterGenerator.generate}. */
export interface FilterGeneratorOptions {
  /** Collection definitions to generate filters for */
  collections: CollectionDefinition[];
  /** Restrict the set of generated operators (default: all) */
  operators?: FilterOperator[];
}

/** Output of the filter generator. */
export interface FilterOutput {
  /** GraphQL SDL containing WhereInput, OrderByInput, and ConnectionInput types */
  typeDefs: string;
  /**
   * Convert a client-supplied filter input object into a
   * Pocket-compatible query filter.
   */
  buildFilter: (input: Record<string, unknown>) => Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '');
}

function mapFieldType(field: FieldDefinition): GraphQLFieldType {
  switch (field.type) {
    case 'string':
      return 'String';
    case 'number':
      return Number.isInteger(field) ? 'Int' : 'Float';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'DateTime';
    case 'reference':
      return 'ID';
    case 'array':
      return 'JSON';
    case 'object':
      return 'JSON';
    default:
      return 'String';
  }
}

/** Operators allowed for each Pocket field type. */
const OPERATORS_BY_FIELD_TYPE: Record<string, FilterOperator[]> = {
  string: ['eq', 'neq', 'contains', 'startsWith', 'endsWith', 'in', 'isNull'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'isNull'],
  boolean: ['eq', 'isNull'],
  reference: ['eq', 'neq', 'in', 'isNull'],
  array: ['isNull'],
  object: ['isNull'],
};

/** GraphQL type for the value side of each operator. */
function operatorGqlType(op: FilterOperator, baseType: GraphQLFieldType): string {
  switch (op) {
    case 'in':
    case 'nin':
      return `[${baseType}!]`;
    case 'isNull':
      return 'Boolean';
    default:
      return baseType;
  }
}

/* ------------------------------------------------------------------ */
/*  FilterGenerator                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generates WhereInput, OrderByInput, and ConnectionInput GraphQL
 * types for every collection, along with a runtime `buildFilter`
 * helper that translates a client-supplied filter into a Pocket query.
 */
export class FilterGenerator {
  /**
   * Generate filter-related type definitions and the `buildFilter` helper.
   *
   * @example
   * ```typescript
   * const gen = new FilterGenerator();
   * const { typeDefs, buildFilter } = gen.generate({
   *   collections: [{ name: 'todos', fields: { title: { type: 'string' } } }],
   * });
   * ```
   */
  generate(options: FilterGeneratorOptions): FilterOutput {
    const { collections, operators } = options;
    const allowedOps = operators ? new Set(operators) : null;
    const parts: string[] = [];

    // Shared enum for sort direction
    parts.push(`enum SortDirection {\n  ASC\n  DESC\n}\n`);

    for (const collection of collections) {
      const typeName = toPascalCase(collection.name);
      parts.push(this.generateWhereInput(collection, typeName, allowedOps));
      parts.push(this.generateOrderByInput(collection, typeName));
      parts.push(this.generateConnectionInput(typeName));
    }

    const typeDefs = parts.join('\n');

    return { typeDefs, buildFilter };
  }

  /* -------------------------------------------------------------- */
  /*  WhereInput                                                    */
  /* -------------------------------------------------------------- */

  private generateWhereInput(
    collection: CollectionDefinition,
    typeName: string,
    allowedOps: Set<FilterOperator> | null,
  ): string {
    const fields: string[] = [];

    for (const [name, field] of Object.entries(collection.fields)) {
      const opsForType = OPERATORS_BY_FIELD_TYPE[field.type] ?? ['eq', 'isNull'];
      const baseGql = mapFieldType(field);

      for (const op of opsForType) {
        if (allowedOps && !allowedOps.has(op)) continue;
        const gqlType = operatorGqlType(op, baseGql);
        fields.push(`  ${name}_${op}: ${gqlType}`);
      }
    }

    // Logical combinators
    fields.push(`  AND: [${typeName}WhereInput!]`);
    fields.push(`  OR: [${typeName}WhereInput!]`);
    fields.push(`  NOT: ${typeName}WhereInput`);

    return `input ${typeName}WhereInput {\n${fields.join('\n')}\n}\n`;
  }

  /* -------------------------------------------------------------- */
  /*  OrderByInput                                                  */
  /* -------------------------------------------------------------- */

  private generateOrderByInput(
    collection: CollectionDefinition,
    typeName: string,
  ): string {
    const sortableTypes = ['string', 'number', 'date', 'boolean', 'reference'];
    const fields = Object.entries(collection.fields)
      .filter(([, f]) => sortableTypes.includes(f.type))
      .map(([name]) => `  ${name}: SortDirection`)
      .join('\n');

    return `input ${typeName}OrderByInput {\n${fields}\n}\n`;
  }

  /* -------------------------------------------------------------- */
  /*  ConnectionInput (cursor-based pagination)                     */
  /* -------------------------------------------------------------- */

  private generateConnectionInput(typeName: string): string {
    return `input ${typeName}ConnectionInput {
  first: Int
  after: String
  last: Int
  before: String
  where: ${typeName}WhereInput
  orderBy: ${typeName}OrderByInput
}
`;
  }
}

/* ------------------------------------------------------------------ */
/*  buildFilter — runtime translation                                 */
/* ------------------------------------------------------------------ */

/**
 * Translate a client-supplied WhereInput object into a flat
 * Pocket-compatible query filter.
 *
 * @example
 * ```typescript
 * const filter = buildFilter({ title_contains: 'ship', priority_gte: 3 });
 * // → { title: { $contains: 'ship' }, priority: { $gte: 3 } }
 * ```
 */
function buildFilter(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;

    // Handle logical combinators
    if (key === 'AND' && Array.isArray(value)) {
      result.$and = value.map((v) => buildFilter(v as Record<string, unknown>));
      continue;
    }
    if (key === 'OR' && Array.isArray(value)) {
      result.$or = value.map((v) => buildFilter(v as Record<string, unknown>));
      continue;
    }
    if (key === 'NOT' && typeof value === 'object' && value !== null) {
      result.$not = buildFilter(value as Record<string, unknown>);
      continue;
    }

    // field_operator pattern
    const sepIdx = key.lastIndexOf('_');
    if (sepIdx === -1) {
      // Plain equality shorthand
      result[key] = value;
      continue;
    }

    const fieldName = key.slice(0, sepIdx);
    const op = key.slice(sepIdx + 1);

    const existing = (result[fieldName] ?? {}) as Record<string, unknown>;

    switch (op) {
      case 'eq':
        existing.$eq = value;
        break;
      case 'neq':
        existing.$neq = value;
        break;
      case 'gt':
        existing.$gt = value;
        break;
      case 'gte':
        existing.$gte = value;
        break;
      case 'lt':
        existing.$lt = value;
        break;
      case 'lte':
        existing.$lte = value;
        break;
      case 'in':
        existing.$in = value;
        break;
      case 'nin':
        existing.$nin = value;
        break;
      case 'contains':
        existing.$contains = value;
        break;
      case 'startsWith':
        existing.$startsWith = value;
        break;
      case 'endsWith':
        existing.$endsWith = value;
        break;
      case 'isNull':
        existing.$isNull = value;
        break;
      default:
        // Unknown operator — pass through as-is
        existing[`$${op}`] = value;
        break;
    }

    result[fieldName] = existing;
  }

  return result;
}

/**
 * Factory function to create a {@link FilterGenerator} instance.
 *
 * @example
 * ```typescript
 * const generator = createFilterGenerator();
 * ```
 */
export function createFilterGenerator(): FilterGenerator {
  return new FilterGenerator();
}
