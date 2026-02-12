/**
 * Vector quantization techniques for memory reduction.
 *
 * Provides scalar and product quantization to compress vector embeddings
 * while maintaining search quality. Useful for large-scale vector stores
 * where memory is constrained.
 *
 * @module quantization
 *
 * @example Scalar quantization
 * ```typescript
 * const quantizer = createScalarQuantizer({ dimensions: 1536, bits: 8 });
 * const quantized = quantizer.quantize([0.1, 0.5, -0.3, ...]);
 * const restored = quantizer.dequantize(quantized);
 * console.log(`Savings: ${quantizer.memorySavings()}%`);
 * ```
 *
 * @example Product quantization
 * ```typescript
 * const pq = createProductQuantizer({ dimensions: 1536, numSubvectors: 96 });
 * pq.train(trainingVectors);
 * const code = pq.quantize([0.1, 0.5, ...]);
 * const restored = pq.dequantize(code);
 * ```
 */

import type { Vector } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration for scalar quantization.
 */
export interface ScalarQuantizerConfig {
  /** Number of dimensions in the vectors */
  dimensions: number;

  /**
   * Number of bits per component (8 = uint8, 4 = nibble).
   * @default 8
   */
  bits?: number;
}

/**
 * Configuration for product quantization.
 */
export interface ProductQuantizerConfig {
  /** Number of dimensions in the vectors */
  dimensions: number;

  /**
   * Number of subvectors to split each vector into.
   * Must evenly divide dimensions.
   * @default 8
   */
  numSubvectors?: number;

  /**
   * Number of centroids per subvector codebook.
   * @default 256
   */
  numCentroids?: number;

  /**
   * Number of k-means iterations for training.
   * @default 20
   */
  maxIterations?: number;
}

/**
 * Quantized vector representation for scalar quantization.
 */
export interface ScalarQuantizedVector {
  /** Quantized component values */
  data: Uint8Array;

  /** Bit width used for quantization */
  bits: number;
}

/**
 * Quantized vector representation for product quantization.
 */
export interface ProductQuantizedVector {
  /** Centroid indices for each subvector */
  codes: Uint8Array;

  /** Number of subvectors */
  numSubvectors: number;
}

/**
 * Result of distortion measurement.
 */
export interface DistortionResult {
  /** Mean squared error between original and reconstructed vectors */
  mse: number;

  /** Average relative error per component */
  relativeError: number;

  /** Number of vectors measured */
  vectorCount: number;
}

// ─── Scalar Quantizer ────────────────────────────────────────────────────────

/**
 * Scalar quantizer that maps float32 values to lower bit-width integers.
 *
 * Learns min/max ranges per dimension from training data and linearly
 * maps values to the quantized range.
 *
 * @example
 * ```typescript
 * const sq = createScalarQuantizer({ dimensions: 384, bits: 8 });
 * sq.train(vectors);  // Learn value ranges
 *
 * const quantized = sq.quantize(vector);
 * const restored = sq.dequantize(quantized);
 * console.log(`Memory savings: ${sq.memorySavings()}%`);
 * ```
 */
export class ScalarQuantizer {
  readonly dimensions: number;
  readonly bits: number;

  private mins: Float32Array;
  private maxs: Float32Array;
  private trained = false;
  private readonly maxVal: number;

  constructor(config: ScalarQuantizerConfig) {
    this.dimensions = config.dimensions;
    this.bits = config.bits ?? 8;
    this.maxVal = (1 << this.bits) - 1;
    this.mins = new Float32Array(this.dimensions);
    this.maxs = new Float32Array(this.dimensions);
  }

  /**
   * Train the quantizer by learning value ranges from sample vectors.
   *
   * @param vectors - Training vectors to learn ranges from
   */
  train(vectors: Vector[]): void {
    if (vectors.length === 0) return;

    // Initialize with first vector
    const first = vectors[0]!;
    for (let d = 0; d < this.dimensions; d++) {
      this.mins[d] = first[d] ?? 0;
      this.maxs[d] = first[d] ?? 0;
    }

    // Find min/max per dimension
    for (const vec of vectors) {
      for (let d = 0; d < this.dimensions; d++) {
        const val = vec[d] ?? 0;
        if (val < this.mins[d]!) {
          this.mins[d] = val;
        }
        if (val > this.maxs[d]!) {
          this.maxs[d] = val;
        }
      }
    }

    this.trained = true;
  }

  /**
   * Quantize a vector from float32 to lower bit-width.
   *
   * @param vector - The vector to quantize
   * @returns Quantized representation
   */
  quantize(vector: Vector): ScalarQuantizedVector {
    if (!this.trained) {
      // Auto-train from single vector with default range [-1, 1]
      for (let d = 0; d < this.dimensions; d++) {
        this.mins[d] = -1;
        this.maxs[d] = 1;
      }
      this.trained = true;
    }

    const data = new Uint8Array(this.dimensions);

    for (let d = 0; d < this.dimensions; d++) {
      const min = this.mins[d]!;
      const max = this.maxs[d]!;
      const range = max - min;
      const val = vector[d] ?? 0;

      if (range === 0) {
        data[d] = 0;
      } else {
        const normalized = Math.max(0, Math.min(1, (val - min) / range));
        data[d] = Math.round(normalized * this.maxVal);
      }
    }

    return { data, bits: this.bits };
  }

  /**
   * Dequantize a vector back to float32.
   *
   * @param quantized - Quantized vector to restore
   * @returns Reconstructed float32 vector
   */
  dequantize(quantized: ScalarQuantizedVector): Vector {
    const vector: number[] = new Array(this.dimensions);

    for (let d = 0; d < this.dimensions; d++) {
      const min = this.mins[d]!;
      const max = this.maxs[d]!;
      const range = max - min;
      const normalized = (quantized.data[d] ?? 0) / this.maxVal;
      vector[d] = min + normalized * range;
    }

    return vector;
  }

  /**
   * Calculate memory savings as a percentage.
   *
   * @returns Percentage of memory saved (0-100)
   */
  memorySavings(): number {
    const originalBits = 32; // float32
    return ((originalBits - this.bits) / originalBits) * 100;
  }

  /**
   * Measure distortion between original and quantized vectors.
   *
   * @param vectors - Vectors to measure distortion for
   * @returns Distortion metrics
   */
  measureDistortion(vectors: Vector[]): DistortionResult {
    if (vectors.length === 0) {
      return { mse: 0, relativeError: 0, vectorCount: 0 };
    }

    let totalMse = 0;
    let totalRelError = 0;
    let componentCount = 0;

    for (const vec of vectors) {
      const quantized = this.quantize(vec);
      const restored = this.dequantize(quantized);

      for (let d = 0; d < this.dimensions; d++) {
        const original = vec[d] ?? 0;
        const reconstructed = restored[d] ?? 0;
        const diff = original - reconstructed;
        totalMse += diff * diff;

        if (Math.abs(original) > 1e-10) {
          totalRelError += Math.abs(diff / original);
        }
        componentCount++;
      }
    }

    return {
      mse: totalMse / componentCount,
      relativeError: totalRelError / componentCount,
      vectorCount: vectors.length,
    };
  }

  /**
   * Whether the quantizer has been trained.
   */
  isTrained(): boolean {
    return this.trained;
  }
}

// ─── Product Quantizer ───────────────────────────────────────────────────────

/**
 * Product quantizer that splits vectors into subvectors and quantizes each
 * independently using learned codebooks.
 *
 * Achieves higher compression than scalar quantization at the cost of
 * requiring a training step.
 *
 * @example
 * ```typescript
 * const pq = createProductQuantizer({
 *   dimensions: 1536,
 *   numSubvectors: 96,
 *   numCentroids: 256,
 * });
 * pq.train(trainingVectors);
 *
 * const quantized = pq.quantize(vector);
 * const restored = pq.dequantize(quantized);
 * ```
 */
export class ProductQuantizer {
  readonly dimensions: number;
  readonly numSubvectors: number;
  readonly numCentroids: number;
  readonly subvectorDim: number;

  private codebooks: Float32Array[][] = [];
  private trained = false;
  private readonly maxIterations: number;

  constructor(config: ProductQuantizerConfig) {
    this.dimensions = config.dimensions;
    this.numSubvectors = config.numSubvectors ?? 8;
    this.numCentroids = config.numCentroids ?? 256;
    this.maxIterations = config.maxIterations ?? 20;

    if (this.dimensions % this.numSubvectors !== 0) {
      throw new Error(
        `Dimensions (${this.dimensions}) must be evenly divisible by numSubvectors (${this.numSubvectors})`
      );
    }

    this.subvectorDim = this.dimensions / this.numSubvectors;
  }

  /**
   * Train codebooks from sample vectors using k-means clustering.
   *
   * @param vectors - Training vectors
   */
  train(vectors: Vector[]): void {
    if (vectors.length === 0) return;

    this.codebooks = [];

    for (let s = 0; s < this.numSubvectors; s++) {
      const offset = s * this.subvectorDim;

      // Extract subvectors
      const subvectors: Float32Array[] = vectors.map((vec) => {
        const sub = new Float32Array(this.subvectorDim);
        for (let d = 0; d < this.subvectorDim; d++) {
          sub[d] = vec[offset + d] ?? 0;
        }
        return sub;
      });

      // Run k-means for this subspace
      const centroids = this.kmeans(subvectors);
      this.codebooks.push(centroids);
    }

    this.trained = true;
  }

  /**
   * Quantize a vector using learned codebooks.
   *
   * @param vector - The vector to quantize
   * @returns Product quantized representation
   */
  quantize(vector: Vector): ProductQuantizedVector {
    if (!this.trained) {
      throw new Error('Product quantizer must be trained before quantization');
    }

    const codes = new Uint8Array(this.numSubvectors);

    for (let s = 0; s < this.numSubvectors; s++) {
      const offset = s * this.subvectorDim;
      const codebook = this.codebooks[s]!;

      let bestIdx = 0;
      let bestDist = Infinity;

      for (let c = 0; c < codebook.length; c++) {
        const centroid = codebook[c]!;
        let dist = 0;
        for (let d = 0; d < this.subvectorDim; d++) {
          const diff = (vector[offset + d] ?? 0) - centroid[d]!;
          dist += diff * diff;
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = c;
        }
      }

      codes[s] = bestIdx;
    }

    return { codes, numSubvectors: this.numSubvectors };
  }

  /**
   * Dequantize by looking up centroids from codebooks.
   *
   * @param quantized - Product quantized vector
   * @returns Reconstructed float32 vector
   */
  dequantize(quantized: ProductQuantizedVector): Vector {
    if (!this.trained) {
      throw new Error('Product quantizer must be trained before dequantization');
    }

    const vector: number[] = new Array(this.dimensions);

    for (let s = 0; s < this.numSubvectors; s++) {
      const offset = s * this.subvectorDim;
      const centroid = this.codebooks[s]![quantized.codes[s]!]!;

      for (let d = 0; d < this.subvectorDim; d++) {
        vector[offset + d] = centroid[d]!;
      }
    }

    return vector;
  }

  /**
   * Calculate memory savings as a percentage.
   *
   * @returns Percentage of memory saved (0-100)
   */
  memorySavings(): number {
    const originalBitsPerVector = this.dimensions * 32; // float32
    const quantizedBitsPerVector = this.numSubvectors * 8; // uint8 codes
    return ((originalBitsPerVector - quantizedBitsPerVector) / originalBitsPerVector) * 100;
  }

  /**
   * Measure distortion between original and quantized vectors.
   *
   * @param vectors - Vectors to measure distortion for
   * @returns Distortion metrics
   */
  measureDistortion(vectors: Vector[]): DistortionResult {
    if (vectors.length === 0) {
      return { mse: 0, relativeError: 0, vectorCount: 0 };
    }

    let totalMse = 0;
    let totalRelError = 0;
    let componentCount = 0;

    for (const vec of vectors) {
      const quantized = this.quantize(vec);
      const restored = this.dequantize(quantized);

      for (let d = 0; d < this.dimensions; d++) {
        const original = vec[d] ?? 0;
        const reconstructed = restored[d] ?? 0;
        const diff = original - reconstructed;
        totalMse += diff * diff;

        if (Math.abs(original) > 1e-10) {
          totalRelError += Math.abs(diff / original);
        }
        componentCount++;
      }
    }

    return {
      mse: totalMse / componentCount,
      relativeError: totalRelError / componentCount,
      vectorCount: vectors.length,
    };
  }

  /**
   * Whether the quantizer has been trained.
   */
  isTrained(): boolean {
    return this.trained;
  }

  /**
   * Simple k-means clustering for codebook learning.
   */
  private kmeans(subvectors: Float32Array[]): Float32Array[] {
    const k = Math.min(this.numCentroids, subvectors.length);
    const dim = this.subvectorDim;

    // Initialize centroids by sampling from subvectors
    const centroids: Float32Array[] = [];
    const step = Math.max(1, Math.floor(subvectors.length / k));
    for (let i = 0; i < k; i++) {
      const idx = Math.min(i * step, subvectors.length - 1);
      centroids.push(new Float32Array(subvectors[idx]!));
    }

    const assignments = new Uint16Array(subvectors.length);

    for (let iter = 0; iter < this.maxIterations; iter++) {
      // Assign each subvector to nearest centroid
      let changed = false;
      for (let i = 0; i < subvectors.length; i++) {
        const sub = subvectors[i]!;
        let bestIdx = 0;
        let bestDist = Infinity;

        for (let c = 0; c < centroids.length; c++) {
          const centroid = centroids[c]!;
          let dist = 0;
          for (let d = 0; d < dim; d++) {
            const diff = sub[d]! - centroid[d]!;
            dist += diff * diff;
          }
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = c;
          }
        }

        if (assignments[i] !== bestIdx) {
          assignments[i] = bestIdx;
          changed = true;
        }
      }

      if (!changed) break;

      // Recompute centroids
      const sums: Float32Array[] = centroids.map(() => new Float32Array(dim));
      const counts = new Uint32Array(centroids.length);

      for (let i = 0; i < subvectors.length; i++) {
        const cluster = assignments[i]!;
        const sub = subvectors[i]!;
        counts[cluster] = (counts[cluster] ?? 0) + 1;
        const sum = sums[cluster]!;
        for (let d = 0; d < dim; d++) {
          sum[d] = (sum[d] ?? 0) + sub[d]!;
        }
      }

      for (let c = 0; c < centroids.length; c++) {
        if (counts[c]! > 0) {
          const sum = sums[c]!;
          for (let d = 0; d < dim; d++) {
            centroids[c]![d] = sum[d]! / counts[c]!;
          }
        }
      }
    }

    return centroids;
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

/**
 * Create a scalar quantizer for float32 → uint8 compression.
 *
 * @param config - Quantizer configuration
 * @returns A new ScalarQuantizer instance
 *
 * @example
 * ```typescript
 * const quantizer = createScalarQuantizer({ dimensions: 1536, bits: 8 });
 * quantizer.train(vectors);
 * const compressed = quantizer.quantize(vector);
 * ```
 */
export function createScalarQuantizer(config: ScalarQuantizerConfig): ScalarQuantizer {
  return new ScalarQuantizer(config);
}

/**
 * Create a product quantizer for high-compression vector encoding.
 *
 * @param config - Quantizer configuration
 * @returns A new ProductQuantizer instance
 *
 * @example
 * ```typescript
 * const pq = createProductQuantizer({
 *   dimensions: 1536,
 *   numSubvectors: 96,
 *   numCentroids: 256,
 * });
 * pq.train(trainingVectors);
 * const compressed = pq.quantize(vector);
 * ```
 */
export function createProductQuantizer(config: ProductQuantizerConfig): ProductQuantizer {
  return new ProductQuantizer(config);
}
