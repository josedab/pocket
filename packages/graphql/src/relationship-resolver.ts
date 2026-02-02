/**
 * Relationship Resolver — generates GraphQL field resolvers for
 * inter-collection references (one-to-one, one-to-many, many-to-many).
 *
 * Includes a DataLoader-style batching layer to prevent N+1 query
 * problems when resolving nested relationships.
 *
 * @example
 * ```typescript
 * import { createRelationshipResolver } from '@pocket/graphql';
 *
 * const resolver = createRelationshipResolver();
 * const { typeDefs, resolvers } = resolver.generate({
 *   collections: [...],
 *   relationships: [
 *     {
 *       sourceCollection: 'posts',
 *       sourceField: 'authorId',
 *       targetCollection: 'users',
 *       type: 'one-to-one',
 *     },
 *   ],
 * });
 * ```
 *
 * @module @pocket/graphql/relationship-resolver
 */

import type { CollectionDefinition, ResolverContext } from './types.js';

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/** Describes a relationship between two collections. */
export interface RelationshipDefinition {
  /** Collection that holds the reference field */
  sourceCollection: string;
  /** Field on the source that stores the foreign key */
  sourceField: string;
  /** Collection being referenced */
  targetCollection: string;
  /** Cardinality of the relationship */
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  /** Foreign key field on the target (for one-to-many inverse lookups) */
  foreignKey?: string;
  /** Junction collection name (required for many-to-many) */
  junctionCollection?: string;
  /** Field in the junction collection pointing to the source */
  junctionSourceKey?: string;
  /** Field in the junction collection pointing to the target */
  junctionTargetKey?: string;
}

/** Options accepted by {@link RelationshipResolver.generate}. */
export interface RelationshipResolverOptions {
  /** Relationship definitions */
  relationships: RelationshipDefinition[];
  /** Collection definitions used for type-name resolution */
  collections: CollectionDefinition[];
}

/** Output of the relationship resolver generator. */
export interface RelationshipOutput {
  /** GraphQL SDL extending source types with relationship fields */
  typeDefs: string;
  /** Nested resolver map (`{ TypeName: { fieldName: resolverFn } }`) */
  resolvers: Record<string, Record<string, unknown>>;
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

/* ------------------------------------------------------------------ */
/*  DataLoader-style batcher                                          */
/* ------------------------------------------------------------------ */

type LoadFn<K, V> = (keys: K[]) => Promise<V[]>;

/**
 * Minimal DataLoader implementation that batches individual `load()`
 * calls within the same tick into a single bulk fetch.
 */
class BatchLoader<K, V> {
  private batch: { key: K; resolve: (v: V) => void; reject: (e: unknown) => void }[] | null = null;

  constructor(private readonly batchFn: LoadFn<K, V>) {}

  load(key: K): Promise<V> {
    return new Promise<V>((resolve, reject) => {
      if (!this.batch) {
        this.batch = [];
        // Schedule flush on next microtask
        void Promise.resolve().then(() => this.flush());
      }
      this.batch.push({ key, resolve, reject });
    });
  }

  private async flush(): Promise<void> {
    const batch = this.batch!;
    this.batch = null;

    const keys = batch.map((b) => b.key);
    try {
      const values = await this.batchFn(keys);
      for (let i = 0; i < batch.length; i++) {
        batch[i]!.resolve(values[i] as V);
      }
    } catch (err) {
      for (const entry of batch) {
        entry.reject(err);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  RelationshipResolver                                              */
/* ------------------------------------------------------------------ */

/**
 * Generates GraphQL type extensions and field resolvers for
 * inter-collection relationships.
 */
export class RelationshipResolver {
  /**
   * Generate relationship type definitions and resolvers.
   *
   * @example
   * ```typescript
   * const resolver = new RelationshipResolver();
   * const { typeDefs, resolvers } = resolver.generate({
   *   collections,
   *   relationships: [
   *     {
   *       sourceCollection: 'posts',
   *       sourceField: 'authorId',
   *       targetCollection: 'users',
   *       type: 'one-to-one',
   *     },
   *   ],
   * });
   * ```
   */
  generate(options: RelationshipResolverOptions): RelationshipOutput {
    const { relationships, collections: _collections } = options;
    const typeExtensions: string[] = [];
    const resolvers: Record<string, Record<string, unknown>> = {};

    // One batch loader per target collection (keyed by collection name)
    const loaderCache = new WeakMap<ResolverContext, Map<string, BatchLoader<string, unknown>>>();

    function getLoader(ctx: ResolverContext, collectionName: string): BatchLoader<string, unknown> {
      if (!loaderCache.has(ctx)) {
        loaderCache.set(ctx, new Map());
      }
      const map = loaderCache.get(ctx)!;
      if (!map.has(collectionName)) {
        map.set(
          collectionName,
          new BatchLoader<string, unknown>(async (ids) => {
            const col = ctx.db.collection(collectionName);
            const results = await Promise.all(ids.map((id) => col.get(id)));
            return results;
          }),
        );
      }
      return map.get(collectionName)!;
    }

    for (const rel of relationships) {
      const sourceType = toPascalCase(rel.sourceCollection);
      const targetType = toPascalCase(rel.targetCollection);

      resolvers[sourceType] ??= {};

      switch (rel.type) {
        case 'one-to-one': {
          const fieldName = rel.sourceField.replace(/Id$/, '');
          typeExtensions.push(
            `extend type ${sourceType} {\n  """ Resolved ${targetType} reference """\n  ${fieldName}: ${targetType}\n}\n`,
          );

          resolvers[sourceType][fieldName] = async (
            parent: Record<string, unknown>,
            _args: Record<string, unknown>,
            context: ResolverContext,
          ) => {
            const id = parent[rel.sourceField] as string | undefined;
            if (!id) return null;
            return getLoader(context, rel.targetCollection).load(id);
          };
          break;
        }

        case 'one-to-many': {
          const foreignKey = rel.foreignKey ?? `${rel.sourceCollection.replace(/s$/, '')}Id`;
          const fieldName = rel.targetCollection;
          typeExtensions.push(
            `extend type ${sourceType} {\n  """ Related ${targetType} documents """\n  ${fieldName}: [${targetType}!]!\n}\n`,
          );

          resolvers[sourceType][fieldName] = async (
            parent: Record<string, unknown>,
            _args: Record<string, unknown>,
            context: ResolverContext,
          ) => {
            const id = parent._id as string;
            const col = context.db.collection(rel.targetCollection);
            return col.find({ filter: { [foreignKey]: id } });
          };
          break;
        }

        case 'many-to-many': {
          const junctionCollection = rel.junctionCollection ?? `${rel.sourceCollection}_${rel.targetCollection}`;
          const junctionSourceKey = rel.junctionSourceKey ?? `${rel.sourceCollection.replace(/s$/, '')}Id`;
          const junctionTargetKey = rel.junctionTargetKey ?? `${rel.targetCollection.replace(/s$/, '')}Id`;
          const fieldName = rel.targetCollection;

          typeExtensions.push(
            `extend type ${sourceType} {\n  """ Related ${targetType} documents (many-to-many) """\n  ${fieldName}: [${targetType}!]!\n}\n`,
          );

          resolvers[sourceType][fieldName] = async (
            parent: Record<string, unknown>,
            _args: Record<string, unknown>,
            context: ResolverContext,
          ) => {
            const sourceId = parent._id as string;
            const junctionCol = context.db.collection(junctionCollection);
            const junctions = await junctionCol.find({
              filter: { [junctionSourceKey]: sourceId },
            });
            const targetIds = junctions.map((j) => j[junctionTargetKey] as string);
            const loader = getLoader(context, rel.targetCollection);
            return Promise.all(targetIds.map((id) => loader.load(id)));
          };
          break;
        }
      }
    }

    const typeDefs = typeExtensions.join('\n');

    return { typeDefs, resolvers };
  }
}

/**
 * Factory function to create a {@link RelationshipResolver} instance.
 *
 * @example
 * ```typescript
 * const resolver = createRelationshipResolver();
 * ```
 */
export function createRelationshipResolver(): RelationshipResolver {
  return new RelationshipResolver();
}
