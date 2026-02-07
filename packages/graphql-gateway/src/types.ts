/** GraphQL type name — built-in scalars or custom type references. */
export type GraphQLTypeName = 'String' | 'Int' | 'Float' | 'Boolean' | 'ID' | 'JSON' | string;

/** A single field within a GraphQL type definition. */
export interface GraphQLFieldDef {
  name: string;
  type: GraphQLTypeName;
  required: boolean;
  description?: string;
  isList?: boolean;
}

/** A GraphQL object type definition. */
export interface GraphQLTypeDef {
  name: string;
  fields: GraphQLFieldDef[];
  description?: string;
}

/** A GraphQL query or mutation definition. */
export interface GraphQLQueryDef {
  name: string;
  returnType: string;
  args?: GraphQLFieldDef[];
  description?: string;
}

/** A GraphQL subscription definition. */
export interface GraphQLSubscriptionDef {
  name: string;
  returnType: string;
  args?: GraphQLFieldDef[];
  description?: string;
}

/** Complete GraphQL schema definition. */
export interface SchemaDefinition {
  types: GraphQLTypeDef[];
  queries: GraphQLQueryDef[];
  mutations: GraphQLQueryDef[];
  subscriptions: GraphQLSubscriptionDef[];
}

/** Maps a Pocket collection to a GraphQL type. */
export interface CollectionMapping {
  collection: string;
  typeName: string;
  fields?: Record<string, string>;
}

/** Configuration for the GraphQL gateway. */
export interface GatewayConfig {
  collections: CollectionMapping[];
  enableSubscriptions: boolean;
  enableMutations: boolean;
  customScalars?: string[];
}

/** Context passed to resolvers. */
export interface ResolverContext {
  collection: string;
  operation: 'query' | 'mutation' | 'subscription';
}

/** Default gateway configuration. */
export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  collections: [],
  enableSubscriptions: true,
  enableMutations: true,
};
