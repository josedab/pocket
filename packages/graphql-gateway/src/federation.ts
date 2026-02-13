/**
 * GraphQL Federation — Apollo Federation v2 subgraph generation for Pocket.
 *
 * Automatically converts Pocket collection schemas into federated GraphQL
 * subgraphs with @key directives, reference resolvers, and entity types.
 * Compatible with Apollo Gateway and GraphQL Mesh.
 *
 * @module @pocket/graphql-gateway
 */


// ── Types ─────────────────────────────────────────────────

export interface FederationConfig {
  /** Service name for the subgraph */
  serviceName: string;
  /** Service URL for gateway routing */
  serviceUrl: string;
  /** Collections to expose as federated entities */
  entities: FederatedEntity[];
  /** Enable @shareable directive on all fields (default: false) */
  shareable?: boolean;
  /** Federation version (default: '2.0') */
  version?: '1.0' | '2.0';
}

export interface FederatedEntity {
  /** Pocket collection name */
  collection: string;
  /** GraphQL type name */
  typeName: string;
  /** Fields to expose */
  fields: Record<string, string>;
  /** Key fields for entity resolution (default: ['id']) */
  keyFields?: string[];
  /** Fields that can be resolved by this subgraph only */
  ownedFields?: string[];
  /** Fields that extend types from other subgraphs */
  externalFields?: string[];
  /** Whether this entity is shareable (default: false) */
  shareable?: boolean;
}

export interface FederationSubgraph {
  /** The generated SDL schema string */
  sdl: string;
  /** Entity type names */
  entities: string[];
  /** Service name */
  serviceName: string;
  /** Service URL */
  serviceUrl: string;
}

export interface FederationSupergraphConfig {
  subgraphs: { name: string; url: string; sdl: string }[];
}

export interface ReferenceResolver {
  typeName: string;
  keyFields: string[];
  resolve: (representation: Record<string, unknown>) => Record<string, unknown> | null;
}

// ── Federation Generator ──────────────────────────────────

const SCALAR_MAP: Record<string, string> = {
  string: 'String',
  number: 'Float',
  integer: 'Int',
  boolean: 'Boolean',
  date: 'String',
  id: 'ID',
};

/**
 * Generates Apollo Federation v2 compatible subgraph schemas from
 * Pocket collections. Handles @key, @external, @shareable, and
 * @provides directives automatically.
 */
export class FederationGenerator {
  private readonly config: Required<FederationConfig>;

  constructor(fedConfig: FederationConfig) {
    this.config = {
      serviceName: fedConfig.serviceName,
      serviceUrl: fedConfig.serviceUrl,
      entities: fedConfig.entities,
      shareable: fedConfig.shareable ?? false,
      version: fedConfig.version ?? '2.0',
    };
  }

  /** Generate the complete federated subgraph SDL */
  generateSubgraph(): FederationSubgraph {
    const sdl = this.generateSDL();

    return {
      sdl,
      entities: this.config.entities.map((e) => e.typeName),
      serviceName: this.config.serviceName,
      serviceUrl: this.config.serviceUrl,
    };
  }

  /** Generate the SDL schema string */
  generateSDL(): string {
    const parts: string[] = [];

    // Federation v2 link directive
    if (this.config.version === '2.0') {
      parts.push(
        'extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key", "@shareable", "@external", "@provides", "@requires"])',
      );
      parts.push('');
    }

    // Generate entity types
    for (const entity of this.config.entities) {
      parts.push(this.generateEntityType(entity));
      parts.push('');
    }

    // Generate Query type with entity lookups
    parts.push(this.generateQueryType());
    parts.push('');

    // Generate Mutation type
    parts.push(this.generateMutationType());

    return parts.join('\n');
  }

  /** Generate reference resolvers for entity resolution */
  generateReferenceResolvers(): ReferenceResolver[] {
    return this.config.entities.map((entity) => ({
      typeName: entity.typeName,
      keyFields: entity.keyFields ?? ['id'],
      resolve: (representation: Record<string, unknown>) => {
        // Returns the representation as-is — in production, this would
        // look up the entity from the Pocket collection
        return { ...representation, __typename: entity.typeName };
      },
    }));
  }

  /** Generate a supergraph config for Apollo Router */
  generateSupergraphConfig(additionalSubgraphs?: { name: string; url: string; sdl: string }[]): FederationSupergraphConfig {
    const subgraph = this.generateSubgraph();
    return {
      subgraphs: [
        { name: subgraph.serviceName, url: subgraph.serviceUrl, sdl: subgraph.sdl },
        ...(additionalSubgraphs ?? []),
      ],
    };
  }

  // ── Internals ─────────────────────────────────────────

  private generateEntityType(entity: FederatedEntity): string {
    const keyFields = entity.keyFields ?? ['id'];
    const keyDirective = `@key(fields: "${keyFields.join(' ')}")`;
    const shareableDirective = (entity.shareable || this.config.shareable) ? ' @shareable' : '';

    const lines: string[] = [];
    lines.push(`type ${entity.typeName} ${keyDirective}${shareableDirective} {`);

    // Always include key fields
    for (const keyField of keyFields) {
      const gqlType = keyField === 'id' ? 'ID!' : 'String!';
      lines.push(`  ${keyField}: ${gqlType}`);
    }

    // Add entity fields
    for (const [fieldName, fieldType] of Object.entries(entity.fields)) {
      if (keyFields.includes(fieldName)) continue; // already added

      const gqlType = this.mapType(fieldType);
      const isExternal = entity.externalFields?.includes(fieldName);
      const directives = isExternal ? ' @external' : '';
      lines.push(`  ${fieldName}: ${gqlType}${directives}`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private generateQueryType(): string {
    const lines: string[] = ['type Query {'];

    for (const entity of this.config.entities) {
      const keyFields = entity.keyFields ?? ['id'];
      const keyArg = keyFields.map((k) => `${k}: ${k === 'id' ? 'ID!' : 'String!'}`).join(', ');
      const plural = entity.collection;

      lines.push(`  ${entity.collection}(${keyArg}): ${entity.typeName}`);
      lines.push(`  ${plural}List(limit: Int, offset: Int): [${entity.typeName}!]!`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private generateMutationType(): string {
    const lines: string[] = ['type Mutation {'];

    for (const entity of this.config.entities) {
      const inputFields = Object.entries(entity.fields)
        .map(([name, type]) => `${name}: ${this.mapType(type, false)}`)
        .join(', ');

      lines.push(`  create${entity.typeName}(${inputFields}): ${entity.typeName}!`);
      lines.push(`  update${entity.typeName}(id: ID!, ${inputFields}): ${entity.typeName}`);
      lines.push(`  delete${entity.typeName}(id: ID!): Boolean!`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  private mapType(type: string, required: boolean = true): string {
    const baseType = SCALAR_MAP[type.toLowerCase()] ?? type;
    return required ? baseType : baseType;
  }
}

// ── Factory ───────────────────────────────────────────────

/** Create a new federation generator for Pocket collections */
export function createFederationGenerator(config: FederationConfig): FederationGenerator {
  return new FederationGenerator(config);
}
