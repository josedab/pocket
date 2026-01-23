import { getDistanceFunction } from './distance.js';
import type { DistanceMetric, Vector, VectorIndex } from './types.js';

/**
 * Flat (brute-force) vector index
 * Simple but effective for small to medium datasets
 */
export class FlatIndex implements VectorIndex {
  readonly name: string;
  private vectors = new Map<string, Vector>();
  private readonly metric: DistanceMetric;
  private readonly distanceFn: (a: Vector, b: Vector) => number;

  constructor(name: string, metric: DistanceMetric = 'cosine') {
    this.name = name;
    this.metric = metric;
    this.distanceFn = getDistanceFunction(metric);
  }

  /**
   * Add a vector to the index
   */
  add(id: string, vector: Vector): void {
    this.vectors.set(id, vector);
  }

  /**
   * Add multiple vectors at once
   */
  addBatch(entries: { id: string; vector: Vector }[]): void {
    for (const { id, vector } of entries) {
      this.vectors.set(id, vector);
    }
  }

  /**
   * Remove a vector from the index
   */
  remove(id: string): void {
    this.vectors.delete(id);
  }

  /**
   * Remove multiple vectors
   */
  removeBatch(ids: string[]): void {
    for (const id of ids) {
      this.vectors.delete(id);
    }
  }

  /**
   * Check if a vector exists
   */
  has(id: string): boolean {
    return this.vectors.has(id);
  }

  /**
   * Get a vector by ID
   */
  get(id: string): Vector | undefined {
    return this.vectors.get(id);
  }

  /**
   * Search for nearest neighbors
   */
  search(query: Vector, k: number): { id: string; distance: number }[] {
    const results: { id: string; distance: number }[] = [];

    // Calculate distance to all vectors
    for (const [id, vector] of this.vectors) {
      const distance = this.distanceFn(query, vector);
      results.push({ id, distance });
    }

    // Sort by distance (ascending) and return top k
    results.sort((a, b) => a.distance - b.distance);

    return results.slice(0, k);
  }

  /**
   * Search with filter function
   */
  searchWithFilter(
    query: Vector,
    k: number,
    filter: (id: string) => boolean
  ): { id: string; distance: number }[] {
    const results: { id: string; distance: number }[] = [];

    for (const [id, vector] of this.vectors) {
      if (!filter(id)) continue;

      const distance = this.distanceFn(query, vector);
      results.push({ id, distance });
    }

    results.sort((a, b) => a.distance - b.distance);

    return results.slice(0, k);
  }

  /**
   * Range search - find all vectors within distance threshold
   */
  rangeSearch(query: Vector, maxDistance: number): { id: string; distance: number }[] {
    const results: { id: string; distance: number }[] = [];

    for (const [id, vector] of this.vectors) {
      const distance = this.distanceFn(query, vector);
      if (distance <= maxDistance) {
        results.push({ id, distance });
      }
    }

    results.sort((a, b) => a.distance - b.distance);

    return results;
  }

  /**
   * Rebuild index (no-op for flat index)
   */
  rebuild(): void {
    // No optimization needed for flat index
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.vectors.clear();
  }

  /**
   * Get all vector IDs
   */
  getIds(): string[] {
    return Array.from(this.vectors.keys());
  }

  /**
   * Get index statistics
   */
  stats(): { count: number; memoryBytes: number } {
    let memoryBytes = 0;

    for (const vector of this.vectors.values()) {
      // Each float64 is 8 bytes
      memoryBytes += vector.length * 8;
    }

    // Add overhead for Map entries (rough estimate)
    memoryBytes += this.vectors.size * 50;

    return {
      count: this.vectors.size,
      memoryBytes,
    };
  }

  /**
   * Export index data
   */
  export(): { id: string; vector: Vector }[] {
    return Array.from(this.vectors.entries()).map(([id, vector]) => ({
      id,
      vector,
    }));
  }

  /**
   * Import index data
   */
  import(data: { id: string; vector: Vector }[]): void {
    for (const { id, vector } of data) {
      this.vectors.set(id, vector);
    }
  }

  /**
   * Get distance metric
   */
  getMetric(): DistanceMetric {
    return this.metric;
  }
}

/**
 * Create a flat index
 */
export function createFlatIndex(name: string, metric: DistanceMetric = 'cosine'): FlatIndex {
  return new FlatIndex(name, metric);
}
