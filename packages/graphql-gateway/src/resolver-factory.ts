import { Observable } from 'rxjs';

import type {
  GatewayConfig,
  SchemaDefinition,
} from './types.js';
import { DEFAULT_GATEWAY_CONFIG } from './types.js';

/** A resolver function signature. */
export type ResolverFunction = (
  args: Record<string, unknown>,
  context?: Record<string, unknown>,
) => Promise<unknown>;

/** A subscription resolver returns an Observable instead of a Promise. */
export type SubscriptionResolverFunction = (
  args: Record<string, unknown>,
  context?: Record<string, unknown>,
) => Observable<unknown>;

/** The full resolver map for a schema. */
export interface ResolverMap {
  Query: Record<string, ResolverFunction>;
  Mutation: Record<string, ResolverFunction>;
  Subscription: Record<string, SubscriptionResolverFunction>;
}

/**
 * Generates resolver stubs from a {@link SchemaDefinition}.
 *
 * The generated resolvers are no-op stubs that return placeholder values.
 * Consumers are expected to wire them to a real Pocket database instance.
 */
export class ResolverFactory {
  private readonly config: GatewayConfig;

  constructor(config: Partial<GatewayConfig> = {}) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
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

  private createQueryResolver(name: string): ResolverFunction {
    return async (_args: Record<string, unknown>) => {
      // Stub: consumers should replace with actual Pocket query logic
      if (name.startsWith('findAll')) {
        return [];
      }
      if (name.startsWith('findMany')) {
        return [];
      }
      // findById
      return null;
    };
  }

  private createMutationResolver(_name: string): ResolverFunction {
    return async (args: Record<string, unknown>) => {
      // Stub: consumers should replace with actual Pocket mutation logic
      if (_name.startsWith('delete')) {
        return true;
      }
      return { id: args['id'] ?? 'new-id', ...((args['input'] as object) ?? {}) };
    };
  }

  private createSubscriptionResolver(_name: string): SubscriptionResolverFunction {
    return (_args: Record<string, unknown>) => {
      // Stub: returns an empty observable; consumers should wire to Pocket reactive queries
      return new Observable((subscriber) => {
        // No-op — real implementation would subscribe to Pocket's change feed
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
