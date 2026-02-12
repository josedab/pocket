import { describe, it, expect, beforeEach } from 'vitest';
import {
  ScalarQuantizer,
  ProductQuantizer,
  createScalarQuantizer,
  createProductQuantizer,
} from '../quantization.js';
import type { Vector } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a random vector of given dimensions in [-1, 1]. */
function randomVector(dimensions: number): Vector {
  return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
}

/** Euclidean distance between two vectors. */
function euclidean(a: Vector, b: Vector): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/* ================================================================== */
/*  ScalarQuantizer                                                     */
/* ================================================================== */

describe('ScalarQuantizer', () => {
  const dims = 16;
  let sq: ScalarQuantizer;

  beforeEach(() => {
    sq = createScalarQuantizer({ dimensions: dims, bits: 8 });
  });

  describe('createScalarQuantizer', () => {
    it('should create instance via factory', () => {
      expect(sq).toBeInstanceOf(ScalarQuantizer);
      expect(sq.dimensions).toBe(dims);
      expect(sq.bits).toBe(8);
    });

    it('should default bits to 8', () => {
      const q = createScalarQuantizer({ dimensions: 4 });
      expect(q.bits).toBe(8);
    });
  });

  describe('isTrained', () => {
    it('should return false before training', () => {
      expect(sq.isTrained()).toBe(false);
    });

    it('should return true after training', () => {
      sq.train([randomVector(dims)]);
      expect(sq.isTrained()).toBe(true);
    });

    it('should auto-train on quantize if not trained', () => {
      sq.quantize(randomVector(dims));
      expect(sq.isTrained()).toBe(true);
    });
  });

  describe('train', () => {
    it('should learn min/max from sample vectors', () => {
      const vectors = Array.from({ length: 20 }, () => randomVector(dims));
      sq.train(vectors);
      expect(sq.isTrained()).toBe(true);
    });

    it('should handle empty training set', () => {
      sq.train([]);
      expect(sq.isTrained()).toBe(false);
    });
  });

  describe('quantize', () => {
    it('should produce Uint8Array data', () => {
      sq.train([randomVector(dims), randomVector(dims)]);
      const q = sq.quantize(randomVector(dims));
      expect(q.data).toBeInstanceOf(Uint8Array);
      expect(q.data.length).toBe(dims);
      expect(q.bits).toBe(8);
    });

    it('should produce values in [0, 255] range for 8-bit', () => {
      const vecs = Array.from({ length: 10 }, () => randomVector(dims));
      sq.train(vecs);
      const q = sq.quantize(vecs[0]!);
      for (let i = 0; i < dims; i++) {
        expect(q.data[i]).toBeGreaterThanOrEqual(0);
        expect(q.data[i]).toBeLessThanOrEqual(255);
      }
    });
  });

  describe('dequantize', () => {
    it('should reconstruct approximate vector', () => {
      const vecs = Array.from({ length: 20 }, () => randomVector(dims));
      sq.train(vecs);

      const original = vecs[0]!;
      const quantized = sq.quantize(original);
      const restored = sq.dequantize(quantized);

      expect(restored.length).toBe(dims);
    });

    it('should round-trip with low error', () => {
      const vecs = Array.from({ length: 50 }, () => randomVector(dims));
      sq.train(vecs);

      const original = vecs[5]!;
      const restored = sq.dequantize(sq.quantize(original));

      const dist = euclidean(original, restored);
      // 8-bit quantization error should be small relative to vector magnitude
      expect(dist).toBeLessThan(1.0);
    });
  });

  describe('memorySavings', () => {
    it('should return compression ratio for 8-bit', () => {
      const savings = sq.memorySavings();
      // (32 - 8) / 32 = 75%
      expect(savings).toBe(75);
    });

    it('should return correct ratio for 4-bit', () => {
      const sq4 = createScalarQuantizer({ dimensions: dims, bits: 4 });
      // (32 - 4) / 32 = 87.5%
      expect(sq4.memorySavings()).toBe(87.5);
    });
  });

  describe('measureDistortion', () => {
    it('should return distortion metrics', () => {
      const vecs = Array.from({ length: 30 }, () => randomVector(dims));
      sq.train(vecs);

      const result = sq.measureDistortion(vecs);
      expect(result.vectorCount).toBe(30);
      expect(result.mse).toBeGreaterThanOrEqual(0);
      expect(result.relativeError).toBeGreaterThanOrEqual(0);
    });

    it('should return zero distortion for empty input', () => {
      sq.train([randomVector(dims)]);
      const result = sq.measureDistortion([]);
      expect(result.mse).toBe(0);
      expect(result.relativeError).toBe(0);
      expect(result.vectorCount).toBe(0);
    });

    it('should produce low MSE for 8-bit quantization', () => {
      const vecs = Array.from({ length: 50 }, () => randomVector(dims));
      sq.train(vecs);

      const result = sq.measureDistortion(vecs);
      // 8-bit quantization should have very low MSE
      expect(result.mse).toBeLessThan(0.01);
    });
  });
});

/* ================================================================== */
/*  ProductQuantizer                                                    */
/* ================================================================== */

describe('ProductQuantizer', () => {
  const dims = 16;
  const numSubvectors = 4;
  let pq: ProductQuantizer;

  beforeEach(() => {
    pq = createProductQuantizer({
      dimensions: dims,
      numSubvectors,
      numCentroids: 4,
      maxIterations: 5,
    });
  });

  describe('createProductQuantizer', () => {
    it('should create instance via factory', () => {
      expect(pq).toBeInstanceOf(ProductQuantizer);
      expect(pq.dimensions).toBe(dims);
      expect(pq.numSubvectors).toBe(numSubvectors);
      expect(pq.subvectorDim).toBe(dims / numSubvectors);
    });

    it('should throw if dimensions not divisible by numSubvectors', () => {
      expect(() =>
        createProductQuantizer({ dimensions: 15, numSubvectors: 4 })
      ).toThrow(/evenly divisible/);
    });

    it('should use defaults for optional config', () => {
      const q = createProductQuantizer({ dimensions: 16 });
      expect(q.numSubvectors).toBe(8);
      expect(q.numCentroids).toBe(256);
    });
  });

  describe('isTrained', () => {
    it('should return false before training', () => {
      expect(pq.isTrained()).toBe(false);
    });

    it('should return true after training', () => {
      const vecs = Array.from({ length: 20 }, () => randomVector(dims));
      pq.train(vecs);
      expect(pq.isTrained()).toBe(true);
    });
  });

  describe('train', () => {
    it('should learn codebooks from training data', () => {
      const vecs = Array.from({ length: 20 }, () => randomVector(dims));
      pq.train(vecs);
      expect(pq.isTrained()).toBe(true);
    });

    it('should handle empty training set', () => {
      pq.train([]);
      expect(pq.isTrained()).toBe(false);
    });
  });

  describe('quantize', () => {
    it('should throw if not trained', () => {
      expect(() => pq.quantize(randomVector(dims))).toThrow(
        /must be trained/
      );
    });

    it('should produce codes of length numSubvectors', () => {
      const vecs = Array.from({ length: 20 }, () => randomVector(dims));
      pq.train(vecs);

      const q = pq.quantize(vecs[0]!);
      expect(q.codes).toBeInstanceOf(Uint8Array);
      expect(q.codes.length).toBe(numSubvectors);
      expect(q.numSubvectors).toBe(numSubvectors);
    });
  });

  describe('dequantize', () => {
    it('should throw if not trained', () => {
      expect(() =>
        pq.dequantize({ codes: new Uint8Array(numSubvectors), numSubvectors })
      ).toThrow(/must be trained/);
    });

    it('should reconstruct vector of correct length', () => {
      const vecs = Array.from({ length: 20 }, () => randomVector(dims));
      pq.train(vecs);

      const q = pq.quantize(vecs[0]!);
      const restored = pq.dequantize(q);
      expect(restored.length).toBe(dims);
    });
  });

  describe('quantize → dequantize round-trip', () => {
    it('should produce similar vector within tolerance', () => {
      const vecs = Array.from({ length: 30 }, () => randomVector(dims));
      pq.train(vecs);

      const original = vecs[5]!;
      const restored = pq.dequantize(pq.quantize(original));

      // PQ with 4 centroids per 4 subvectors is lossy but should be in range
      const dist = euclidean(original, restored);
      expect(dist).toBeLessThan(5.0);
    });
  });

  describe('memorySavings', () => {
    it('should return high compression ratio', () => {
      const savings = pq.memorySavings();
      // originalBits = 16*32 = 512, quantized = 4*8 = 32 → (512-32)/512 ≈ 93.75%
      expect(savings).toBeCloseTo(93.75, 1);
    });
  });

  describe('measureDistortion', () => {
    it('should return distortion metrics', () => {
      const vecs = Array.from({ length: 20 }, () => randomVector(dims));
      pq.train(vecs);

      const result = pq.measureDistortion(vecs);
      expect(result.vectorCount).toBe(20);
      expect(result.mse).toBeGreaterThanOrEqual(0);
      expect(result.relativeError).toBeGreaterThanOrEqual(0);
    });

    it('should return zero for empty input', () => {
      const vecs = Array.from({ length: 10 }, () => randomVector(dims));
      pq.train(vecs);

      const result = pq.measureDistortion([]);
      expect(result.mse).toBe(0);
      expect(result.relativeError).toBe(0);
      expect(result.vectorCount).toBe(0);
    });
  });
});
