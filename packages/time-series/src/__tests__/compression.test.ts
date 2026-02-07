import { describe, it, expect } from 'vitest';
import { GorillaCompressor, createGorillaCompressor } from '../compression.js';
import type { TimeSeriesPoint } from '../types.js';

/* ================================================================== */
/*  GorillaCompressor                                                  */
/* ================================================================== */

describe('GorillaCompressor', () => {
  it('should compress and decompress roundtrip', () => {
    const compressor = createGorillaCompressor();
    const points: TimeSeriesPoint[] = [
      { timestamp: 1_700_000_000_000, value: 42.5 },
      { timestamp: 1_700_000_001_000, value: 43.1 },
      { timestamp: 1_700_000_002_000, value: 41.8 },
      { timestamp: 1_700_000_003_000, value: 44.2 },
      { timestamp: 1_700_000_004_000, value: 42.9 },
    ];

    const compressed = compressor.compress(points);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBeGreaterThan(0);

    const decompressed = compressor.decompress(compressed);
    expect(decompressed).toHaveLength(points.length);

    for (let i = 0; i < points.length; i++) {
      expect(decompressed[i].timestamp).toBe(points[i].timestamp);
      expect(decompressed[i].value).toBeCloseTo(points[i].value, 10);
    }
  });

  it('should handle empty array', () => {
    const compressor = new GorillaCompressor();

    const compressed = compressor.compress([]);
    expect(compressed).toBeInstanceOf(Uint8Array);
    expect(compressed.length).toBe(4); // Just the count header

    const decompressed = compressor.decompress(compressed);
    expect(decompressed).toHaveLength(0);
  });

  it('should preserve timestamp and value precision', () => {
    const compressor = createGorillaCompressor();
    const points: TimeSeriesPoint[] = [
      { timestamp: 1_700_000_000_001, value: 3.141592653589793 },
      { timestamp: 1_700_000_000_002, value: 2.718281828459045 },
      { timestamp: 1_700_000_000_003, value: 0.0 },
      { timestamp: 1_700_000_000_004, value: -273.15 },
      { timestamp: 1_700_000_000_005, value: 1e10 },
    ];

    const compressed = compressor.compress(points);
    const decompressed = compressor.decompress(compressed);

    expect(decompressed).toHaveLength(points.length);
    for (let i = 0; i < points.length; i++) {
      expect(decompressed[i].timestamp).toBe(points[i].timestamp);
      expect(decompressed[i].value).toBe(points[i].value);
    }
  });

  it('should handle single point', () => {
    const compressor = createGorillaCompressor();
    const points: TimeSeriesPoint[] = [
      { timestamp: 1_700_000_000_000, value: 99.9 },
    ];

    const compressed = compressor.compress(points);
    const decompressed = compressor.decompress(compressed);

    expect(decompressed).toHaveLength(1);
    expect(decompressed[0].timestamp).toBe(1_700_000_000_000);
    expect(decompressed[0].value).toBe(99.9);
  });
});
