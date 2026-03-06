/**
 * Types for API compatibility layers.
 *
 * Defines interfaces for wrapping Pocket databases with
 * competitor-compatible APIs (RxDB, Dexie) to ease migration.
 *
 * @module compat/types
 */

/** Compatibility layer configuration */
export interface CompatLayerConfig {
  logDeprecations?: boolean;
  strictMode?: boolean;
}

/** Compat layer for RxDB API */
export interface RxDBCompatAPI {
  createRxDatabase(config: Record<string, unknown>): Promise<unknown>;
  addCollections(collections: Record<string, unknown>): Promise<void>;
}

/** Compat layer for Dexie API */
export interface DexieCompatAPI {
  version(num: number): { stores(schema: Record<string, string>): unknown };
  table(name: string): unknown;
  open(): Promise<void>;
  close(): void;
}
