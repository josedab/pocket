/**
 * Auto-schema generator that creates a federated GraphQL schema
 * from Pocket collection definitions.
 */
import type {
  GraphQLFieldDef,
  GraphQLQueryDef,
  GraphQLSubscriptionDef,
  GraphQLTypeDef,
  SchemaDefinition,
} from './types.js';

export interface CollectionSchema {
  name: string;
  fields: Record<string, FieldDefinition>;
  primaryKey?: string;
  indexes?: string[];
}

export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array' | 'reference';
  required?: boolean;
  description?: string;
  refCollection?: string;
  items?: FieldDefinition;
}

export interface AutoSchemaConfig {
  collections: CollectionSchema[];
  generateMutations?: boolean;
  generateSubscriptions?: boolean;
  federationEnabled?: boolean;
  prefix?: string;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function mapFieldType(field: FieldDefinition): {
  type: string;
  required: boolean;
  isList: boolean;
} {
  const typeMap: Record<string, string> = {
    string: 'String',
    number: 'Float',
    boolean: 'Boolean',
    date: 'DateTime',
    object: 'JSON',
    array: 'JSON',
  };

  if (field.type === 'reference' && field.refCollection) {
    return {
      type: capitalize(field.refCollection),
      required: field.required ?? false,
      isList: false,
    };
  }

  if (field.type === 'array' && field.items) {
    const inner = mapFieldType(field.items);
    return { type: inner.type, required: field.required ?? false, isList: true };
  }

  return {
    type: typeMap[field.type] ?? 'String',
    required: field.required ?? false,
    isList: false,
  };
}

function renderFieldType(field: GraphQLFieldDef): string {
  const base = field.isList ? `[${field.type}]` : field.type;
  return field.required ? `${base}!` : base;
}

function renderArg(arg: GraphQLFieldDef): string {
  return `${arg.name}: ${renderFieldType(arg)}`;
}

/**
 * Auto-generates a complete GraphQL schema from collection definitions.
 */
export class AutoSchemaGenerator {
  private readonly config: AutoSchemaConfig;
  private readonly scalars = ['DateTime', 'JSON'];

  constructor(config: AutoSchemaConfig) {
    this.config = {
      generateMutations: true,
      generateSubscriptions: true,
      federationEnabled: false,
      ...config,
    };
  }

  generate(): SchemaDefinition {
    const types: GraphQLTypeDef[] = [];
    const queries: GraphQLQueryDef[] = [];
    const mutations: GraphQLQueryDef[] = [];
    const subscriptions: GraphQLSubscriptionDef[] = [];

    types.push(
      { name: 'DateTime', fields: [], description: 'ISO 8601 date-time string' },
      { name: 'JSON', fields: [], description: 'Arbitrary JSON value' }
    );

    for (const collection of this.config.collections) {
      const typeName = this.getTypeName(collection.name);
      const { typeDef, inputDef, filterDef } = this.generateTypeDefsForCollection(
        collection,
        typeName
      );

      types.push(typeDef, inputDef, filterDef);
      queries.push(...this.generateQueriesForCollection(collection, typeName));

      if (this.config.generateMutations) {
        mutations.push(...this.generateMutationsForCollection(collection, typeName));
      }

      if (this.config.generateSubscriptions) {
        subscriptions.push(...this.generateSubscriptionsForCollection(collection, typeName));
      }
    }

    return { types, queries, mutations, subscriptions };
  }

  generateSDL(): string {
    const schema = this.generate();
    const lines: string[] = [];

    if (this.config.federationEnabled) {
      lines.push(
        'extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable"])'
      );
      lines.push('');
    }

    // Scalars
    for (const scalar of this.scalars) {
      lines.push(`scalar ${scalar}`);
    }
    lines.push('');

    // Types
    for (const type of schema.types) {
      if (this.scalars.includes(type.name)) continue;
      if (type.description) lines.push(`"""${type.description}"""`);

      const isInput = type.name.endsWith('Input') || type.name.endsWith('Filter');
      const keyword = isInput ? 'input' : 'type';
      const directives =
        this.config.federationEnabled && !isInput ? this.getFederationDirectives(type) : '';

      lines.push(`${keyword} ${type.name}${directives} {`);
      for (const field of type.fields) {
        const desc = field.description ? `  """${field.description}"""\n` : '';
        lines.push(`${desc}  ${field.name}: ${renderFieldType(field)}`);
      }
      lines.push('}');
      lines.push('');
    }

    // Query type
    if (schema.queries.length > 0) {
      lines.push('type Query {');
      for (const q of schema.queries) {
        const args = q.args?.length ? `(${q.args.map(renderArg).join(', ')})` : '';
        lines.push(`  ${q.name}${args}: ${q.returnType}`);
      }
      lines.push('}');
      lines.push('');
    }

    // Mutation type
    if (schema.mutations.length > 0) {
      lines.push('type Mutation {');
      for (const m of schema.mutations) {
        const args = m.args?.length ? `(${m.args.map(renderArg).join(', ')})` : '';
        lines.push(`  ${m.name}${args}: ${m.returnType}`);
      }
      lines.push('}');
      lines.push('');
    }

    // Subscription type
    if (schema.subscriptions.length > 0) {
      lines.push('type Subscription {');
      for (const s of schema.subscriptions) {
        const args = s.args?.length ? `(${s.args.map(renderArg).join(', ')})` : '';
        lines.push(`  ${s.name}${args}: ${s.returnType}`);
      }
      lines.push('}');
    }

    return lines.join('\n');
  }

  private getTypeName(collectionName: string): string {
    const prefix = this.config.prefix ?? '';
    return prefix + capitalize(collectionName);
  }

  private generateTypeDefsForCollection(
    collection: CollectionSchema,
    typeName: string
  ): { typeDef: GraphQLTypeDef; inputDef: GraphQLTypeDef; filterDef: GraphQLTypeDef } {
    const fields: GraphQLFieldDef[] = [
      { name: 'id', type: 'ID', required: true },
      { name: 'createdAt', type: 'DateTime', required: false },
      { name: 'updatedAt', type: 'DateTime', required: false },
    ];

    const inputFields: GraphQLFieldDef[] = [];
    const filterFields: GraphQLFieldDef[] = [{ name: 'id', type: 'ID', required: false }];

    for (const [name, def] of Object.entries(collection.fields)) {
      const mapped = mapFieldType(def);
      fields.push({
        name,
        type: mapped.type,
        required: mapped.required,
        isList: mapped.isList,
        description: def.description,
      });
      inputFields.push({
        name,
        type: mapped.type,
        required: false,
        isList: mapped.isList,
        description: def.description,
      });
      filterFields.push({
        name,
        type: mapped.type,
        required: false,
        description: `Filter by ${name}`,
      });
    }

    return {
      typeDef: { name: typeName, fields, description: `${collection.name} document` },
      inputDef: {
        name: `${typeName}Input`,
        fields: inputFields,
        description: `Input for creating/updating ${collection.name}`,
      },
      filterDef: {
        name: `${typeName}Filter`,
        fields: filterFields,
        description: `Filter for querying ${collection.name}`,
      },
    };
  }

  private generateQueriesForCollection(
    collection: CollectionSchema,
    typeName: string
  ): GraphQLQueryDef[] {
    const name = collection.name;
    return [
      {
        name: `get${typeName}`,
        args: [{ name: 'id', type: 'ID', required: true }],
        returnType: typeName,
        description: `Get a single ${name} by ID`,
      },
      {
        name: `list${typeName}s`,
        args: [
          { name: 'filter', type: `${typeName}Filter`, required: false },
          { name: 'limit', type: 'Int', required: false },
          { name: 'offset', type: 'Int', required: false },
          { name: 'sortBy', type: 'String', required: false },
          { name: 'sortOrder', type: 'String', required: false },
        ],
        returnType: `[${typeName}!]!`,
        description: `List ${name} documents`,
      },
      {
        name: `count${typeName}s`,
        args: [{ name: 'filter', type: `${typeName}Filter`, required: false }],
        returnType: 'Int!',
        description: `Count ${name} documents`,
      },
    ];
  }

  private generateMutationsForCollection(
    collection: CollectionSchema,
    typeName: string
  ): GraphQLQueryDef[] {
    return [
      {
        name: `create${typeName}`,
        args: [{ name: 'input', type: `${typeName}Input`, required: true }],
        returnType: `${typeName}!`,
        description: `Create a new ${collection.name}`,
      },
      {
        name: `update${typeName}`,
        args: [
          { name: 'id', type: 'ID', required: true },
          { name: 'input', type: `${typeName}Input`, required: true },
        ],
        returnType: `${typeName}!`,
        description: `Update an existing ${collection.name}`,
      },
      {
        name: `delete${typeName}`,
        args: [{ name: 'id', type: 'ID', required: true }],
        returnType: 'Boolean!',
        description: `Delete a ${collection.name}`,
      },
    ];
  }

  private generateSubscriptionsForCollection(
    collection: CollectionSchema,
    typeName: string
  ): GraphQLSubscriptionDef[] {
    return [
      {
        name: `on${typeName}Created`,
        args: [{ name: 'filter', type: `${typeName}Filter`, required: false }],
        returnType: `${typeName}!`,
        description: `Subscribe to new ${collection.name} documents`,
      },
      {
        name: `on${typeName}Updated`,
        args: [{ name: 'id', type: 'ID', required: false }],
        returnType: `${typeName}!`,
        description: `Subscribe to ${collection.name} updates`,
      },
      {
        name: `on${typeName}Deleted`,
        args: [{ name: 'id', type: 'ID', required: false }],
        returnType: `${typeName}!`,
        description: `Subscribe to ${collection.name} deletions`,
      },
    ];
  }

  private getFederationDirectives(type: GraphQLTypeDef): string {
    if (type.name.endsWith('Input') || type.name.endsWith('Filter')) return '';
    const idField = type.fields.find((f) => f.name === 'id');
    if (idField) {
      return ' @key(fields: "id")';
    }
    return '';
  }
}

export function createAutoSchemaGenerator(config: AutoSchemaConfig): AutoSchemaGenerator {
  return new AutoSchemaGenerator(config);
}
