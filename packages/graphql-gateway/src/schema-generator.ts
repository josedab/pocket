import type {
  CollectionMapping,
  GatewayConfig,
  GraphQLFieldDef,
  GraphQLQueryDef,
  GraphQLSubscriptionDef,
  GraphQLTypeDef,
  GraphQLTypeName,
  SchemaDefinition,
} from './types.js';
import { DEFAULT_GATEWAY_CONFIG } from './types.js';

/** Pocket-type → GraphQL-type mapping. */
const TYPE_MAP: Record<string, GraphQLTypeName> = {
  string: 'String',
  number: 'Float',
  integer: 'Int',
  boolean: 'Boolean',
  id: 'ID',
  json: 'JSON',
  object: 'JSON',
  array: 'JSON',
};

/**
 * Generates GraphQL schema definitions from Pocket collection mappings.
 */
export class SchemaGenerator {
  private readonly config: GatewayConfig;

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
  }

  /** Map a Pocket field type string to a GraphQL type name. */
  mapFieldType(pocketType: string): GraphQLTypeName {
    return TYPE_MAP[pocketType.toLowerCase()] ?? 'String';
  }

  /** Add a collection mapping at runtime. */
  addCollection(mapping: CollectionMapping): void {
    this.config.collections.push(mapping);
  }

  /** Generate a full {@link SchemaDefinition} from the current config. */
  generateSchema(): SchemaDefinition {
    const types: GraphQLTypeDef[] = [];
    const queries: GraphQLQueryDef[] = [];
    const mutations: GraphQLQueryDef[] = [];
    const subscriptions: GraphQLSubscriptionDef[] = [];

    for (const mapping of this.config.collections) {
      types.push(this.generateTypeDef(mapping));
      queries.push(...this.generateQueryDefs(mapping));

      if (this.config.enableMutations) {
        mutations.push(...this.generateMutationDefs(mapping));
      }

      if (this.config.enableSubscriptions) {
        subscriptions.push(...this.generateSubscriptionDefs(mapping));
      }
    }

    return { types, queries, mutations, subscriptions };
  }

  /** Render the schema as a GraphQL SDL string. */
  generateSDL(): string {
    const schema = this.generateSchema();
    const parts: string[] = [];

    // Custom scalars
    if (this.config.customScalars?.length) {
      for (const scalar of this.config.customScalars) {
        parts.push(`scalar ${scalar}`);
      }
      parts.push('');
    }

    // Type definitions
    for (const typeDef of schema.types) {
      parts.push(this.typeDefToSDL(typeDef));
    }

    // Query type
    if (schema.queries.length > 0) {
      parts.push(this.operationTypeToSDL('Query', schema.queries));
    }

    // Mutation type
    if (schema.mutations.length > 0) {
      parts.push(this.operationTypeToSDL('Mutation', schema.mutations));
    }

    // Subscription type
    if (schema.subscriptions.length > 0) {
      parts.push(this.operationTypeToSDL('Subscription', schema.subscriptions));
    }

    return parts.join('\n\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  private generateTypeDef(mapping: CollectionMapping): GraphQLTypeDef {
    const fields: GraphQLFieldDef[] = [
      { name: 'id', type: 'ID', required: true },
    ];

    if (mapping.fields) {
      for (const [fieldName, fieldType] of Object.entries(mapping.fields)) {
        fields.push({
          name: fieldName,
          type: this.mapFieldType(fieldType),
          required: false,
        });
      }
    }

    return {
      name: mapping.typeName,
      fields,
      description: `Auto-generated type for the ${mapping.collection} collection.`,
    };
  }

  private generateQueryDefs(mapping: CollectionMapping): GraphQLQueryDef[] {
    const { typeName } = mapping;
    return [
      {
        name: `findAll${typeName}s`,
        returnType: `[${typeName}!]!`,
        args: [
          { name: 'filter', type: 'JSON', required: false },
          { name: 'sort', type: 'JSON', required: false },
          { name: 'limit', type: 'Int', required: false },
        ],
        description: `Retrieve all ${typeName} documents.`,
      },
      {
        name: `find${typeName}ById`,
        returnType: typeName,
        args: [{ name: 'id', type: 'ID', required: true }],
        description: `Find a single ${typeName} by ID.`,
      },
      {
        name: `findMany${typeName}s`,
        returnType: `[${typeName}!]!`,
        args: [
          { name: 'ids', type: 'ID', required: true, isList: true },
        ],
        description: `Find multiple ${typeName} documents by IDs.`,
      },
    ];
  }

  private generateMutationDefs(mapping: CollectionMapping): GraphQLQueryDef[] {
    const { typeName } = mapping;

    return [
      {
        name: `create${typeName}`,
        returnType: `${typeName}!`,
        args: [{ name: 'input', type: 'JSON', required: true }],
        description: `Create a new ${typeName}.`,
      },
      {
        name: `update${typeName}`,
        returnType: `${typeName}!`,
        args: [
          { name: 'id', type: 'ID', required: true },
          { name: 'input', type: 'JSON', required: true },
        ],
        description: `Update an existing ${typeName}.`,
      },
      {
        name: `delete${typeName}`,
        returnType: 'Boolean!',
        args: [{ name: 'id', type: 'ID', required: true }],
        description: `Delete a ${typeName} by ID.`,
      },
    ];
  }

  private generateSubscriptionDefs(mapping: CollectionMapping): GraphQLSubscriptionDef[] {
    const { typeName } = mapping;

    return [
      {
        name: `on${typeName}Change`,
        returnType: `${typeName}!`,
        args: [{ name: 'filter', type: 'JSON', required: false }],
        description: `Subscribe to changes on ${typeName} documents.`,
      },
    ];
  }

  private typeDefToSDL(typeDef: GraphQLTypeDef): string {
    const lines: string[] = [];

    if (typeDef.description) {
      lines.push(`"""${typeDef.description}"""`);
    }

    lines.push(`type ${typeDef.name} {`);

    for (const field of typeDef.fields) {
      const typeStr = field.isList
        ? `[${field.type}${field.required ? '!' : ''}]`
        : `${field.type}${field.required ? '!' : ''}`;
      lines.push(`  ${field.name}: ${typeStr}`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private operationTypeToSDL(
    operationName: string,
    defs: GraphQLQueryDef[],
  ): string {
    const lines: string[] = [];
    lines.push(`type ${operationName} {`);

    for (const def of defs) {
      const argsStr = this.argsToSDL(def.args);
      lines.push(`  ${def.name}${argsStr}: ${def.returnType}`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private argsToSDL(args?: GraphQLFieldDef[]): string {
    if (!args || args.length === 0) return '';

    const parts = args.map((arg) => {
      let typeStr = arg.type;
      if (arg.isList) {
        typeStr = `[${typeStr}${arg.required ? '!' : ''}]`;
      } else if (arg.required) {
        typeStr = `${typeStr}!`;
      }
      return `${arg.name}: ${typeStr}`;
    });

    return `(${parts.join(', ')})`;
  }
}

/** Factory function to create a {@link SchemaGenerator}. */
export function createSchemaGenerator(config: Partial<GatewayConfig> = {}): SchemaGenerator {
  return new SchemaGenerator(config);
}
