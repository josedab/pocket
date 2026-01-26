/**
 * @pocket/core - Data Seeder
 *
 * Provides data seeding capabilities for development and testing.
 *
 * @module @pocket/core/seed
 */

import type { Document, NewDocument } from '../types/document.js';

/**
 * Factory function for generating seed data
 */
export type SeedFactory<T> = (index: number, context: SeedContext) => T | Promise<T>;

/**
 * Seed context passed to factory functions
 */
export interface SeedContext {
  /** Current environment */
  environment: string;
  /** Collection being seeded */
  collection: string;
  /** Random number generator with seed support */
  random: () => number;
  /** Generate a random ID */
  randomId: () => string;
  /** Generate a random date within a range */
  randomDate: (start: Date, end: Date) => Date;
  /** Pick a random item from an array */
  randomPick: <T>(items: T[]) => T;
  /** Generate a random integer */
  randomInt: (min: number, max: number) => number;
}

/**
 * Collection seed configuration
 */
export interface CollectionSeedConfig<T = Record<string, unknown>> {
  /** Static data to seed */
  data?: T[];
  /** Factory function to generate data */
  factory?: SeedFactory<T>;
  /** Number of documents to generate (when using factory) */
  count?: number;
  /** Clear collection before seeding */
  clear?: boolean;
  /** Only seed if collection is empty */
  onlyIfEmpty?: boolean;
}

/**
 * Seed configuration
 */
export interface SeedConfig {
  /** Environments where seeding is allowed */
  environments?: string[];
  /** Collection seed configurations */
  collections: Record<string, CollectionSeedConfig>;
  /** Random seed for reproducible data generation */
  randomSeed?: number;
}

/**
 * Seedable collection interface
 */
export interface SeedableCollection<T extends Document = Document> {
  /** Collection name */
  name: string;
  /** Insert a document */
  insert: (doc: NewDocument<T>) => Promise<T>;
  /** Insert multiple documents */
  insertMany: (docs: NewDocument<T>[]) => Promise<T[]>;
  /** Count documents */
  count: () => Promise<number>;
  /** Clear all documents */
  clear: () => Promise<void>;
}

/**
 * Seed result for a single collection
 */
export interface CollectionSeedResult {
  /** Collection name */
  collection: string;
  /** Number of documents inserted */
  insertedCount: number;
  /** Whether collection was cleared */
  cleared: boolean;
  /** Whether seeding was skipped */
  skipped: boolean;
  /** Reason for skipping (if applicable) */
  skipReason?: string;
  /** Execution time in ms */
  executionTimeMs: number;
}

/**
 * Full seed result
 */
export interface SeedResult {
  /** Results per collection */
  collections: CollectionSeedResult[];
  /** Total documents inserted */
  totalInserted: number;
  /** Total execution time in ms */
  totalExecutionTimeMs: number;
  /** Current environment */
  environment: string;
}

/**
 * Create a seeded random number generator
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * Generate a random UUID-like string
 */
function generateRandomId(random: () => number): string {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) {
      id += '-';
    }
    const idx = Math.floor(random() * 16);
    id += hex.charAt(idx);
  }
  return id;
}

/**
 * Data Seeder
 *
 * Seeds database collections with development or test data.
 *
 * @example
 * ```typescript
 * const seeder = new Seeder({
 *   environments: ['development', 'test'],
 *   collections: {
 *     users: {
 *       data: [
 *         { name: 'Admin', email: 'admin@example.com', role: 'admin' }
 *       ]
 *     },
 *     posts: {
 *       factory: (i) => ({
 *         title: `Post ${i + 1}`,
 *         content: `Content for post ${i + 1}`,
 *         authorId: 'user-1'
 *       }),
 *       count: 50
 *     }
 *   }
 * });
 *
 * const result = await seeder.seed(collections, 'development');
 * console.log(`Seeded ${result.totalInserted} documents`);
 * ```
 */
export class Seeder {
  private config: SeedConfig;
  private random: () => number;

  constructor(config: SeedConfig) {
    this.config = config;
    this.random = createSeededRandom(config.randomSeed ?? Date.now());
  }

  /**
   * Create a seed context
   */
  private createContext(collection: string, environment: string): SeedContext {
    const random = this.random;
    return {
      environment,
      collection,
      random,
      randomId: () => generateRandomId(random),
      randomDate: (start: Date, end: Date) => {
        const startTime = start.getTime();
        const endTime = end.getTime();
        return new Date(startTime + random() * (endTime - startTime));
      },
      randomPick: <T>(items: T[]) => {
        const idx = Math.floor(random() * items.length);
        const item = items[idx];
        if (item === undefined) {
          throw new Error('randomPick called with empty array');
        }
        return item;
      },
      randomInt: (min: number, max: number) => {
        return Math.floor(random() * (max - min + 1)) + min;
      },
    };
  }

  /**
   * Check if seeding is allowed in the current environment
   */
  isAllowed(environment: string): boolean {
    if (!this.config.environments || this.config.environments.length === 0) {
      return true;
    }
    return this.config.environments.includes(environment);
  }

  /**
   * Seed a single collection
   */
  async seedCollection<T extends Document>(
    collection: SeedableCollection<T>,
    config: CollectionSeedConfig<NewDocument<T>>,
    environment: string
  ): Promise<CollectionSeedResult> {
    const startTime = performance.now();
    const result: CollectionSeedResult = {
      collection: collection.name,
      insertedCount: 0,
      cleared: false,
      skipped: false,
      executionTimeMs: 0,
    };

    // Check onlyIfEmpty
    if (config.onlyIfEmpty) {
      const count = await collection.count();
      if (count > 0) {
        result.skipped = true;
        result.skipReason = 'Collection not empty';
        result.executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
        return result;
      }
    }

    // Clear if requested
    if (config.clear) {
      await collection.clear();
      result.cleared = true;
    }

    const context = this.createContext(collection.name, environment);
    const documents: NewDocument<T>[] = [];

    // Add static data
    if (config.data && config.data.length > 0) {
      documents.push(...config.data);
    }

    // Generate data from factory
    if (config.factory && config.count && config.count > 0) {
      for (let i = 0; i < config.count; i++) {
        const doc = await config.factory(i, context);
        documents.push(doc);
      }
    }

    // Insert documents
    if (documents.length > 0) {
      await collection.insertMany(documents);
      result.insertedCount = documents.length;
    }

    result.executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
    return result;
  }

  /**
   * Seed all configured collections
   *
   * @param collections - Map of collection name to collection instance
   * @param environment - Current environment
   * @returns Seed result
   */
  async seed(
    collections: Record<string, SeedableCollection>,
    environment: string
  ): Promise<SeedResult> {
    const startTime = performance.now();
    const results: CollectionSeedResult[] = [];
    let totalInserted = 0;

    // Check if seeding is allowed
    if (!this.isAllowed(environment)) {
      return {
        collections: [],
        totalInserted: 0,
        totalExecutionTimeMs: 0,
        environment,
      };
    }

    // Seed each collection
    for (const [name, config] of Object.entries(this.config.collections)) {
      const collection = collections[name];

      if (!collection) {
        results.push({
          collection: name,
          insertedCount: 0,
          cleared: false,
          skipped: true,
          skipReason: 'Collection not found',
          executionTimeMs: 0,
        });
        continue;
      }

      const result = await this.seedCollection(collection, config, environment);
      results.push(result);
      totalInserted += result.insertedCount;
    }

    return {
      collections: results,
      totalInserted,
      totalExecutionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
      environment,
    };
  }

  /**
   * Clear all seeded collections
   *
   * @param collections - Map of collection name to collection instance
   */
  async clear(collections: Record<string, SeedableCollection>): Promise<void> {
    for (const name of Object.keys(this.config.collections)) {
      const collection = collections[name];
      if (collection) {
        await collection.clear();
      }
    }
  }
}

/**
 * Create a new seeder instance
 *
 * @param config - Seed configuration
 * @returns A new Seeder instance
 *
 * @example
 * ```typescript
 * const seeder = createSeeder({
 *   environments: ['development'],
 *   collections: {
 *     users: {
 *       factory: (i) => ({ name: `User ${i}` }),
 *       count: 10
 *     }
 *   }
 * });
 * ```
 */
export function createSeeder(config: SeedConfig): Seeder {
  return new Seeder(config);
}

/**
 * Define a seed configuration with type safety
 *
 * @param config - Seed configuration
 * @returns The same configuration (for type inference)
 *
 * @example
 * ```typescript
 * // pocket.seed.ts
 * import { defineSeed } from '@pocket/core';
 *
 * export default defineSeed({
 *   environments: ['development', 'test'],
 *   collections: {
 *     users: {
 *       data: [{ name: 'Admin', role: 'admin' }]
 *     }
 *   }
 * });
 * ```
 */
export function defineSeed(config: SeedConfig): SeedConfig {
  return config;
}
