/**
 * Subscription Generator — creates GraphQL subscription types and
 * resolver functions for real-time collection change events.
 *
 * Uses an RxJS-style observable → AsyncIterator pattern so subscriptions
 * work with any spec-compliant GraphQL server.
 *
 * @example
 * ```typescript
 * import { createSubscriptionGenerator } from '@pocket/graphql';
 *
 * const generator = createSubscriptionGenerator();
 * const { typeDefs, resolvers } = generator.generate({
 *   collections: [{ name: 'todos', fields: { title: { type: 'string' } } }],
 * });
 * ```
 *
 * @module @pocket/graphql/subscription-generator
 */

import type { CollectionDefinition } from './types.js';

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/** Describes a single subscription field in the generated schema. */
export interface SubscriptionField {
  /** GraphQL field name (e.g. `onTodoCreated`) */
  name: string;
  /** Source collection name */
  collection: string;
  /** Human-readable description */
  description: string;
  /** GraphQL return type */
  returnType: string;
}

/** Options accepted by {@link SubscriptionGenerator.generate}. */
export interface SubscriptionGeneratorOptions {
  /** Collection definitions to generate subscriptions for */
  collections: CollectionDefinition[];
  /** Optional prefix for subscription field names */
  prefix?: string;
}

/** Output of the subscription generator. */
export interface SubscriptionOutput {
  /** GraphQL SDL containing the Subscription type */
  typeDefs: string;
  /** Resolver map keyed by subscription field name */
  resolvers: Record<string, SubscriptionResolverEntry>;
  /** Metadata about generated subscription fields */
  fields: SubscriptionField[];
}

/** A single subscription resolver entry following the GraphQL spec. */
export interface SubscriptionResolverEntry {
  subscribe: () => AsyncIterableIterator<Record<string, unknown>>;
  resolve?: (payload: unknown) => unknown;
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

/**
 * Minimal pub/sub implementation that bridges push-based events to the
 * pull-based AsyncIterableIterator interface expected by GraphQL.
 */
function createPubSub(): {
  publish: (event: string, payload: unknown) => void;
  asyncIterator: (event: string) => AsyncIterableIterator<unknown>;
} {
  const listeners = new Map<string, Set<(value: unknown) => void>>();

  function publish(event: string, payload: unknown): void {
    const subs = listeners.get(event);
    if (subs) {
      for (const cb of subs) {
        cb(payload);
      }
    }
  }

  function asyncIterator(event: string): AsyncIterableIterator<unknown> {
    const queue: unknown[] = [];
    let resolve: ((value: IteratorResult<unknown>) => void) | null = null;
    let done = false;

    const callback = (value: unknown): void => {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value, done: false });
      } else {
        queue.push(value);
      }
    };

    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event)!.add(callback);

    return {
      next(): Promise<IteratorResult<unknown>> {
        if (done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift(), done: false });
        }
        return new Promise((r) => {
          resolve = r;
        });
      },
      return(): Promise<IteratorResult<unknown>> {
        done = true;
        listeners.get(event)?.delete(callback);
        return Promise.resolve({ value: undefined, done: true });
      },
      throw(err: unknown): Promise<IteratorResult<unknown>> {
        done = true;
        listeners.get(event)?.delete(callback);
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  return { publish, asyncIterator };
}

/* ------------------------------------------------------------------ */
/*  SubscriptionGenerator                                             */
/* ------------------------------------------------------------------ */

const CHANGE_KINDS = ['Created', 'Updated', 'Deleted', 'Changed'] as const;

/**
 * Generates GraphQL subscription SDL and resolvers for collection
 * change events (created, updated, deleted, changed).
 */
export class SubscriptionGenerator {
  private readonly pubSub = createPubSub();

  /**
   * Generate subscription type definitions and resolvers.
   *
   * @example
   * ```typescript
   * const gen = new SubscriptionGenerator();
   * const { typeDefs, resolvers } = gen.generate({
   *   collections: [{ name: 'todos', fields: { title: { type: 'string' } } }],
   * });
   * ```
   */
  generate(options: SubscriptionGeneratorOptions): SubscriptionOutput {
    const { collections, prefix = '' } = options;
    const fields: SubscriptionField[] = [];
    const resolvers: Record<string, SubscriptionResolverEntry> = {};
    const lines: string[] = [];

    for (const collection of collections) {
      const typeName = toPascalCase(collection.name);

      for (const kind of CHANGE_KINDS) {
        const fieldName = `${prefix}on${typeName}${kind}`;
        const eventName = `${collection.name}_${kind.toUpperCase()}`;
        const description = `Fires when a ${typeName} document is ${kind.toLowerCase()}`;

        fields.push({
          name: fieldName,
          collection: collection.name,
          description,
          returnType: `${typeName}!`,
        });

        lines.push(`  """ ${description} """`);
        lines.push(`  ${fieldName}: ${typeName}!`);

        resolvers[fieldName] = {
          subscribe: () => {
            return this.pubSub.asyncIterator(eventName) as AsyncIterableIterator<Record<string, unknown>>;
          },
          resolve: (payload: unknown) => payload,
        };
      }
    }

    const typeDefs = `type Subscription {\n${lines.join('\n')}\n}\n`;

    return { typeDefs, resolvers, fields };
  }

  /**
   * Publish an event to active subscribers.
   *
   * @param collection - Collection name (e.g. `"todos"`)
   * @param kind       - Change kind (`"Created"`, `"Updated"`, `"Deleted"`, or `"Changed"`)
   * @param payload    - The document payload
   */
  publish(collection: string, kind: (typeof CHANGE_KINDS)[number], payload: unknown): void {
    const eventName = `${collection}_${kind.toUpperCase()}`;
    this.pubSub.publish(eventName, payload);
  }
}

/**
 * Factory function to create a {@link SubscriptionGenerator} instance.
 *
 * @example
 * ```typescript
 * const generator = createSubscriptionGenerator();
 * ```
 */
export function createSubscriptionGenerator(): SubscriptionGenerator {
  return new SubscriptionGenerator();
}
