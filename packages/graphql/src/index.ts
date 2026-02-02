/**
 * @pocket/graphql — Auto-generated GraphQL for Pocket
 *
 * Generates GraphQL schema (SDL) and resolvers from Pocket collection
 * definitions. Works with any GraphQL server (Apollo, Yoga, etc.).
 *
 * @example
 * ```typescript
 * import { generateSchema, generateResolvers } from '@pocket/graphql';
 *
 * const collections = [
 *   {
 *     name: 'todos',
 *     fields: {
 *       title: { type: 'string', required: true },
 *       completed: { type: 'boolean' },
 *     },
 *   },
 * ];
 *
 * const typeDefs = generateSchema({ collections });
 * const resolvers = generateResolvers(collections);
 *
 * // Use with any GraphQL server
 * // const server = new ApolloServer({ typeDefs, resolvers });
 * ```
 *
 * @module @pocket/graphql
 */

// Types
export type {
  CollectionDefinition,
  CollectionLike,
  DatabaseLike,
  FieldDefinition,
  GeneratedResolver,
  GraphQLFieldType,
  ResolverContext,
  ResolverFunction,
  SchemaGeneratorConfig,
  SubscriptionResolver,
} from './types.js';

// Schema Generator
export { generateSchema } from './schema-generator.js';

// Resolver Generator
export { generateResolvers, createResolverContext } from './resolver-generator.js';

// Subscription Generator
export {
  SubscriptionGenerator,
  createSubscriptionGenerator,
} from './subscription-generator.js';
export type {
  SubscriptionField,
  SubscriptionGeneratorOptions,
  SubscriptionOutput,
  SubscriptionResolverEntry,
} from './subscription-generator.js';

// Relationship Resolver
export {
  RelationshipResolver,
  createRelationshipResolver,
} from './relationship-resolver.js';
export type {
  RelationshipDefinition,
  RelationshipResolverOptions,
  RelationshipOutput,
} from './relationship-resolver.js';

// Filter Generator
export {
  FilterGenerator,
  createFilterGenerator,
} from './filter-generator.js';
export type {
  FilterOperator,
  FilterGeneratorOptions,
  FilterOutput,
} from './filter-generator.js';
