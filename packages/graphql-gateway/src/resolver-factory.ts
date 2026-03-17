import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

import type {
  CollectionAccessor,
  CollectionChangeEvent,
  GatewayConfig,
  SchemaDefinition,
} from './types.js';
import { DEFAULT_GATEWAY_CONFIG } from './types.js';

/** A resolver function signature. */
export type ResolverFunction = (
  args: Record<string, unknown>,
  context?: Record<string, unknown>
) => Promise<unknown>;

/** A subscription resolver returns an Observable instead of a Promise. */
export type SubscriptionResolverFunction = (
  args: Record<string, unknown>,
  context?: Record<string, unknown>
) => Observable<unknown>;

/** The full resolver map for a schema. */
export interface ResolverMap {
  Query: Record<string, ResolverFunction>;
  Mutation: Record<string, ResolverFunction>;
  Subscription: Record<string, SubscriptionResolverFunction>;
}

/**
 * Generates resolvers from a {@link SchemaDefinition}.
 *
 * When a {@link GatewayConfig.getCollection} callback is supplied, the
 * generated resolvers delegate to the real Pocket database.  Without it
 * the resolvers fall back to no-op stubs that return placeholder values.
 */
export class ResolverFactory {
  private readonly config: GatewayConfig;

  /**
   * Reverse map from GraphQL type name to Pocket collection name,
   * built once from `config.collections`.
   */
  private readonly typeToCollection: Map<string, string>;

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };

    this.typeToCollection = new Map();
    for (const mapping of this.config.collections) {
      this.typeToCollection.set(mapping.typeName, mapping.collection);
    }
  }

  /** Create a full resolver map from the given schema definition. */
  createResolvers(schema: SchemaDefinition): ResolverMap {
    const Query: Record<string, ResolverFunction> = {};
    const Mutation: Record<string, ResolverFunction> = {};
    const Subscription: Record<string, SubscriptionResolverFunction> = {};

    for (const queryDef of schema.queries) {
      Query[queryDef.name] = this.createQueryResolver(queryDef.name);
    }

    if (this.config.enableMutations) {
      for (const mutationDef of schema.mutations) {
        Mutation[mutationDef.name] = this.createMutationResolver(mutationDef.name);
      }
    }

    if (this.config.enableSubscriptions) {
      for (const subDef of schema.subscriptions) {
        Subscription[subDef.name] = this.createSubscriptionResolver(subDef.name);
      }
    }

    return { Query, Mutation, Subscription };
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Resolve a collection accessor for the given resolver name by matching
   * against the configured {@link CollectionMapping} entries.
   *
   * Type names are tried longest-first to avoid substring collisions
   * (e.g. `TodoItem` before `Todo`).
   */
  private getAccessor(resolverName: string): CollectionAccessor | undefined {
    if (!this.config.getCollection) return undefined;

    // Sort by typeName length descending to avoid substring issues
    const sorted = [...this.typeToCollection.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [typeName, collectionName] of sorted) {
      if (resolverName.includes(typeName)) {
        return this.config.getCollection(collectionName);
      }
    }
    return undefined;
  }

  private createQueryResolver(name: string): ResolverFunction {
    return async (args: Record<string, unknown>) => {
      const collection = this.getAccessor(name);

      if (collection) {
        // get{Type} / findOne — single document by ID
        if (name.startsWith('get') || name.startsWith('findOne')) {
          return collection.get(args.id as string);
        }

        // list{Type}s / findAll / findMany — multiple documents
        if (name.startsWith('list') || name.startsWith('findAll') || name.startsWith('findMany')) {
          return collection.find({
            filter: args.filter as Record<string, unknown> | undefined,
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
            sortBy: args.sortBy as string | undefined,
            sortOrder: args.sortOrder as 'asc' | 'desc' | undefined,
          });
        }

        // count{Type}s
        if (name.startsWith('count')) {
          return collection.count(args.filter as Record<string, unknown> | undefined);
        }

        // Fallback for unrecognised query patterns — try get by ID
        return collection.get(args.id as string);
      }

      // Stub fallback (no database wired)
      if (name.startsWith('findAll') || name.startsWith('findMany') || name.startsWith('list')) {
        return [];
      }
      if (name.startsWith('count')) {
        return 0;
      }
      return null;
    };
  }

  private createMutationResolver(name: string): ResolverFunction {
    return async (args: Record<string, unknown>) => {
      const collection = this.getAccessor(name);

      if (collection) {
        if (name.startsWith('create')) {
          return collection.insert(args.input as Record<string, unknown>);
        }
        if (name.startsWith('update')) {
          return collection.update(args.id as string, args.input as Record<string, unknown>);
        }
        if (name.startsWith('delete')) {
          await collection.delete(args.id as string);
          return true;
        }
      }

      // Stub fallback
      if (name.startsWith('delete')) {
        return true;
      }
      return { id: args.id ?? 'new-id', ...((args.input as object) ?? {}) };
    };
  }

  private createSubscriptionResolver(name: string): SubscriptionResolverFunction {
    return (_args: Record<string, unknown>) => {
      const collection = this.getAccessor(name);

      if (collection) {
        const changes$ = collection.changes();

        let operationFilter: CollectionChangeEvent['operation'] | undefined;
        if (name.includes('Created')) operationFilter = 'insert';
        else if (name.includes('Updated')) operationFilter = 'update';
        else if (name.includes('Deleted')) operationFilter = 'delete';

        if (operationFilter) {
          return changes$.pipe(
            filter((event: CollectionChangeEvent) => event.operation === operationFilter),
            map((event: CollectionChangeEvent) => event.document)
          );
        }

        // No specific filter — emit all changes
        return changes$.pipe(map((event: CollectionChangeEvent) => event.document));
      }

      // Stub fallback — empty observable
      return new Observable((subscriber) => {
        return () => {
          subscriber.complete();
        };
      });
    };
  }
}

/** Factory function to create a {@link ResolverFactory}. */
export function createResolverFactory(config: Partial<GatewayConfig> = {}): ResolverFactory {
  return new ResolverFactory(config);
}
