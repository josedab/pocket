import { PocketError } from '@pocket/core';
import type { DistanceMetric, Vector } from './types.js';

/**
 * Calculate cosine similarity between two vectors
 * Returns value between -1 and 1 (1 = identical)
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw PocketError.fromCode('POCKET_V102', {
      message: `Vector dimensions must match: ${a.length} vs ${b.length}`,
      expected: a.length,
      actual: b.length,
    });
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i]!;
    const bVal = b[i]!;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Calculate cosine distance (1 - similarity)
 * Returns value between 0 and 2 (0 = identical)
 */
export function cosineDistance(a: Vector, b: Vector): number {
  return 1 - cosineSimilarity(a, b);
}

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw PocketError.fromCode('POCKET_V102', {
      message: `Vector dimensions must match: ${a.length} vs ${b.length}`,
      expected: a.length,
      actual: b.length,
    });
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Calculate dot product of two vectors
 */
export function dotProduct(a: Vector, b: Vector): number {
  if (a.length !== b.length) {
    throw PocketError.fromCode('POCKET_V102', {
      message: `Vector dimensions must match: ${a.length} vs ${b.length}`,
      expected: a.length,
      actual: b.length,
    });
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result += a[i]! * b[i]!;
  }

  return result;
}

/**
 * Get distance function for a given metric
 */
export function getDistanceFunction(metric: DistanceMetric): (a: Vector, b: Vector) => number {
  switch (metric) {
    case 'cosine':
      return cosineDistance;
    case 'euclidean':
      return euclideanDistance;
    case 'dotProduct':
      // For dot product, higher is better, so we negate for distance
      return (a, b) => -dotProduct(a, b);
    default:
      return cosineDistance;
  }
}

/**
 * Convert distance to similarity score (0-1 range)
 */
export function distanceToScore(distance: number, metric: DistanceMetric): number {
  switch (metric) {
    case 'cosine':
      // Cosine distance is 0-2, convert to 0-1 similarity
      return Math.max(0, 1 - distance);
    case 'euclidean':
      // Convert euclidean distance to similarity
      return 1 / (1 + distance);
    case 'dotProduct':
      // Dot product was negated for distance, convert back to similarity
      return 1 / (1 + Math.abs(distance));
    default:
      return Math.max(0, 1 - distance);
  }
}

/**
 * Normalize a vector to unit length
 */
export function normalize(vector: Vector): Vector {
  const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

  if (norm === 0) {
    return vector;
  }

  return vector.map((val) => val / norm);
}

/**
 * Calculate the magnitude (L2 norm) of a vector
 */
export function magnitude(vector: Vector): number {
  return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
}

/**
 * Add two vectors element-wise
 */
export function addVectors(a: Vector, b: Vector): Vector {
  if (a.length !== b.length) {
    throw PocketError.fromCode('POCKET_V102', {
      message: `Vector dimensions must match: ${a.length} vs ${b.length}`,
      expected: a.length,
      actual: b.length,
    });
  }

  return a.map((val, i) => val + b[i]!);
}

/**
 * Subtract two vectors element-wise (a - b)
 */
export function subtractVectors(a: Vector, b: Vector): Vector {
  if (a.length !== b.length) {
    throw PocketError.fromCode('POCKET_V102', {
      message: `Vector dimensions must match: ${a.length} vs ${b.length}`,
      expected: a.length,
      actual: b.length,
    });
  }

  return a.map((val, i) => val - b[i]!);
}

/**
 * Multiply a vector by a scalar
 */
export function scaleVector(vector: Vector, scalar: number): Vector {
  return vector.map((val) => val * scalar);
}

/**
 * Calculate the average of multiple vectors
 */
export function averageVectors(vectors: Vector[]): Vector {
  if (vectors.length === 0) {
    throw PocketError.fromCode('POCKET_V100', {
      message: 'Cannot average empty vector array',
      operation: 'averageVectors',
    });
  }

  const dimensions = vectors[0]!.length;
  const result: number[] = new Array<number>(dimensions).fill(0);

  for (const vector of vectors) {
    if (vector.length !== dimensions) {
      throw PocketError.fromCode('POCKET_V102', {
        message: 'All vectors must have the same dimensions',
        expected: dimensions,
        actual: vector.length,
      });
    }
    for (let i = 0; i < dimensions; i++) {
      result[i] = (result[i] ?? 0) + (vector[i] ?? 0);
    }
  }

  return result.map((val) => val / vectors.length);
}

/**
 * Create a zero vector of given dimensions
 */
export function zeroVector(dimensions: number): Vector {
  return new Array(dimensions).fill(0);
}

/**
 * Create a random unit vector of given dimensions
 */
export function randomUnitVector(dimensions: number): Vector {
  const vector = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    // Generate random values from normal distribution
    vector[i] = Math.random() * 2 - 1;
  }
  return normalize(vector);
}
