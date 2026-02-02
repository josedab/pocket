/**
 * Types for @pocket/graphql
 */

export type GraphQLFieldType =
  | 'String'
  | 'Int'
  | 'Float'
  | 'Boolean'
  | 'ID'
  | 'DateTime'
  | 'JSON';

export interface CollectionDefinition {
  /** Collection name */
  name: string;
  /** Field definitions */
  fields: Record<string, FieldDefinition>;
  /** Human-readable description */
  description?: string;
}

export interface FieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'reference';
  required?: boolean;
  description?: string;
  items?: FieldDefinition;
  reference?: { collection: string };
}

export interface SchemaGeneratorConfig {
  /** Collection definitions */
  collections: CollectionDefinition[];
  /** Include subscription types (default: true) */
  includeSubscriptions?: boolean;
  /** Include mutation types (default: true) */
  includeMutations?: boolean;
  /** Custom scalar definitions */
  customScalars?: Record<string, string>;
}

export interface ResolverContext {
  db: DatabaseLike;
}

export interface DatabaseLike {
  collection<T = Record<string, unknown>>(name: string): CollectionLike<T>;
}

export interface CollectionLike<T = Record<string, unknown>> {
  get(id: string): Promise<T | null>;
  find(options?: {
    filter?: Record<string, unknown>;
    sort?: Record<string, unknown>;
    limit?: number;
    skip?: number;
  }): Promise<T[]>;
  insert(doc: T): Promise<T>;
  update(id: string, changes: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface GeneratedResolver {
  Query: Record<string, ResolverFunction>;
  Mutation: Record<string, ResolverFunction>;
  Subscription?: Record<string, SubscriptionResolver>;
}

export type ResolverFunction = (
  parent: unknown,
  args: Record<string, unknown>,
  context: ResolverContext,
) => Promise<unknown>;

export interface SubscriptionResolver {
  subscribe: (
    parent: unknown,
    args: Record<string, unknown>,
    context: ResolverContext,
  ) => AsyncIterable<unknown>;
}
