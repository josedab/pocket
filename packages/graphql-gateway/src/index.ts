/**
 * @pocket/graphql-gateway - GraphQL Live Query Gateway for Pocket
 *
 * @example
 * ```typescript
 * import {
 *   createSchemaGenerator,
 *   createResolverFactory,
 *   createSubscriptionManager,
 * } from '@pocket/graphql-gateway';
 *
 * // Define collection mappings
 * const generator = createSchemaGenerator({
 *   collections: [
 *     { collection: 'todos', typeName: 'Todo', fields: { title: 'string', completed: 'boolean' } },
 *     { collection: 'users', typeName: 'User', fields: { name: 'string', email: 'string' } },
 *   ],
 *   enableSubscriptions: true,
 *   enableMutations: true,
 * });
 *
 * // Generate SDL and resolver stubs
 * const sdl = generator.generateSDL();
 * const schema = generator.generateSchema();
 *
 * const factory = createResolverFactory();
 * const resolvers = factory.createResolvers(schema);
 *
 * // Manage subscriptions
 * const subscriptions = createSubscriptionManager();
 * const unsub = subscriptions.subscribe('todos', undefined, (event) => {
 *   console.log('Change:', event);
 * });
 * ```
 */

// Types
export type {
  CollectionMapping,
  GatewayConfig,
  GraphQLFieldDef,
  GraphQLQueryDef,
  GraphQLSubscriptionDef,
  GraphQLTypeDef,
  GraphQLTypeName,
  ResolverContext,
  SchemaDefinition,
} from './types.js';

export { DEFAULT_GATEWAY_CONFIG } from './types.js';

// Schema Generator
export { SchemaGenerator, createSchemaGenerator } from './schema-generator.js';

// Resolver Factory
export type {
  ResolverFunction,
  ResolverMap,
  SubscriptionResolverFunction,
} from './resolver-factory.js';

export { ResolverFactory, createResolverFactory } from './resolver-factory.js';

// Subscription Manager
export type {
  ActiveSubscription,
  SubscriptionCallback,
  SubscriptionEvent,
} from './subscription-manager.js';

export { SubscriptionManager, createSubscriptionManager } from './subscription-manager.js';

// Auth Directives
export type {
  AuthDirectiveConfig,
  DirectiveMiddleware,
  DirectiveName,
  FieldDirective,
  MiddlewareContext,
  MiddlewareResult,
  UserContext,
  UserRole,
} from './auth-directives.js';

export { AuthDirectiveHandler, createAuthDirectiveHandler } from './auth-directives.js';

// Query Complexity
export type {
  ComplexityResult,
  FieldCostEntry,
  QueryComplexityConfig,
  QueryFieldNode,
} from './query-complexity.js';

export { QueryComplexityAnalyzer, createQueryComplexityAnalyzer } from './query-complexity.js';

// DataLoader
export type { BatchLoadFn, DataLoaderConfig, LoaderOptions, LoaderStats } from './data-loader.js';

export { DataLoaderRegistry, createDataLoaderRegistry } from './data-loader.js';

// Pagination
export type {
  Connection,
  CursorPaginationArgs,
  Edge,
  OffsetPage,
  OffsetPaginationArgs,
  PageInfo,
  PaginationConfig,
} from './pagination.js';

export { PaginationHelper, createPaginationHelper } from './pagination.js';

// Federation
export { FederationGenerator, createFederationGenerator } from './federation.js';
export type {
  FederatedEntity,
  FederationConfig,
  FederationSubgraph,
  FederationSupergraphConfig,
  ReferenceResolver,
} from './federation.js';

// SDL Parser
export type {
  CollectionConfig,
  DirectiveDefinition,
  ParsedEnum,
  ParsedField,
  ParsedSDL,
  ParsedType,
  PocketDirective,
  SDLParserConfig,
  SDLToCollectionResult,
} from './sdl-parser.js';

export { SDLParser, createSDLParser } from './sdl-parser.js';

// Apollo Cache Adapter
export type {
  ApolloCacheConfig,
  CacheEntry,
  CacheEvent,
  CacheQuery,
  CacheStats,
} from './apollo-adapter.js';

export { ApolloCacheAdapter, createApolloCacheAdapter } from './apollo-adapter.js';
