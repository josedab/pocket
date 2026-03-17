import type { Observable } from 'rxjs';

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
  /**
   * Optional callback that returns a {@link CollectionAccessor} for the given
   * collection name.  When provided, generated resolvers delegate to the
   * real database instead of returning stub values.
   */
  getCollection?: (name: string) => CollectionAccessor | undefined;
}

/** Context passed to resolvers. */
export interface ResolverContext {
  collection: string;
  operation: 'query' | 'mutation' | 'subscription';
}

/** Change event emitted by a collection. */
export interface CollectionChangeEvent {
  operation: 'insert' | 'update' | 'delete';
  documentId: string;
  document: unknown;
}

/** Query options for list/find operations. */
export interface FindOptions {
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Minimal collection interface for database-backed resolvers.
 *
 * Designed to be compatible with Pocket's `Collection` class without
 * coupling the gateway directly to `@pocket/core` internals.
 */
export interface CollectionAccessor {
  get(id: string): Promise<unknown>;
  find(options?: FindOptions): Promise<unknown[]>;
  count(filter?: Record<string, unknown>): Promise<number>;
  insert(doc: Record<string, unknown>): Promise<unknown>;
  update(id: string, changes: Record<string, unknown>): Promise<unknown>;
  delete(id: string): Promise<void>;
  changes(): Observable<CollectionChangeEvent>;
}

/** Default gateway configuration. */
export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  collections: [],
  enableSubscriptions: true,
  enableMutations: true,
};
