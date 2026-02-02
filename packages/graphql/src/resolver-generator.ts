/**
 * Resolver Generator — creates CRUD resolvers for Pocket collections.
 *
 * Resolvers work with any GraphQL server (Apollo, GraphQL Yoga, etc.)
 * by conforming to the standard resolver signature.
 */

import type {
  CollectionDefinition,
  DatabaseLike,
  GeneratedResolver,
  ResolverContext,
  ResolverFunction,
} from './types.js';

function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
    .replace(/s$/, '');
}

/**
 * Generate resolver maps for the given collections.
 */
export function generateResolvers(collections: CollectionDefinition[]): GeneratedResolver {
  const Query: Record<string, ResolverFunction> = {};
  const Mutation: Record<string, ResolverFunction> = {};

  for (const collection of collections) {
    const typeName = toPascalCase(collection.name);

    // Query: list
    Query[collection.name] = async (_parent, args, context) => {
      const col = context.db.collection(collection.name);
      const filterArg = (args.filter ?? {}) as Record<string, unknown>;
      const { _limit, _skip, ...fieldFilters } = filterArg;

      return col.find({
        filter: Object.keys(fieldFilters).length > 0 ? fieldFilters : undefined,
        limit: typeof _limit === 'number' ? _limit : undefined,
        skip: typeof _skip === 'number' ? _skip : undefined,
      });
    };

    // Query: getById
    Query[`${typeName.toLowerCase()}ById`] = async (_parent, args, context) => {
      const col = context.db.collection(collection.name);
      return col.get(args.id as string);
    };

    // Mutation: create
    Mutation[`create${typeName}`] = async (_parent, args, context) => {
      const col = context.db.collection(collection.name);
      const input = args.input as Record<string, unknown>;
      return col.insert({
        _id: crypto.randomUUID(),
        ...input,
      });
    };

    // Mutation: update
    Mutation[`update${typeName}`] = async (_parent, args, context) => {
      const col = context.db.collection(collection.name);
      return col.update(args.id as string, args.input as Record<string, unknown>);
    };

    // Mutation: delete
    Mutation[`delete${typeName}`] = async (_parent, args, context) => {
      const col = context.db.collection(collection.name);
      await col.delete(args.id as string);
      return true;
    };
  }

  return { Query, Mutation };
}

/**
 * Create a resolver context from a Pocket database instance.
 */
export function createResolverContext(db: DatabaseLike): ResolverContext {
  return { db };
}
