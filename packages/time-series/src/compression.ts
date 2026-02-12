/**
 * Gorilla-inspired compression for time-series data
 *
 * Uses delta-of-delta encoding for timestamps and XOR-based
 * compression for values to achieve efficient storage.
 */

import type { TimeSeriesPoint } from './types.js';

/**
 * Compressor for time-series data using delta encoding
 */
export class GorillaCompressor {
  /**
   * Compress an array of time-series points into a Uint8Array.
   *
   * Encoding layout:
   *   [4 bytes: point count]
   *   [8 bytes: first timestamp (float64)]
   *   [8 bytes: first value    (float64)]
   *   For each subsequent point:
   *     [8 bytes: timestamp delta (float64)]
   *     [8 bytes: XOR of current and previous value (float64)]
   */
  compress(points: TimeSeriesPoint[]): Uint8Array {
    if (points.length === 0) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setUint32(0, 0);
      return new Uint8Array(buf);
    }

    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

    // Header (4 bytes count) + first point (16 bytes) + deltas (16 bytes each)
    const bufSize = 4 + 16 + (sorted.length - 1) * 16;
    const buffer = new ArrayBuffer(bufSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write point count
    view.setUint32(offset, sorted.length);
    offset += 4;

    // Write first point
    view.setFloat64(offset, sorted[0]!.timestamp);
    offset += 8;
    view.setFloat64(offset, sorted[0]!.value);
    offset += 8;

    // Write deltas for subsequent points
    let prevTimestamp = sorted[0]!.timestamp;
    let prevValue = sorted[0]!.value;

    for (let i = 1; i < sorted.length; i++) {
      const tsDelta = sorted[i]!.timestamp - prevTimestamp;
      view.setFloat64(offset, tsDelta);
      offset += 8;

      // XOR encoding: store XOR of current and previous value
      const xorValue = this.xorFloat64(sorted[i]!.value, prevValue);
      view.setFloat64(offset, xorValue);
      offset += 8;

      prevTimestamp = sorted[i]!.timestamp;
      prevValue = sorted[i]!.value;
    }

    return new Uint8Array(buffer);
  }

  /**
   * Decompress a Uint8Array back into time-series points
   */
  decompress(data: Uint8Array): TimeSeriesPoint[] {
    if (data.length < 4) return [];

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const count = view.getUint32(offset);
    offset += 4;

    if (count === 0) return [];

    const points: TimeSeriesPoint[] = [];

    // Read first point
    const firstTimestamp = view.getFloat64(offset);
    offset += 8;
    const firstValue = view.getFloat64(offset);
    offset += 8;

    points.push({ timestamp: firstTimestamp, value: firstValue });

    // Read deltas
    let prevTimestamp = firstTimestamp;
    let prevValue = firstValue;

    for (let i = 1; i < count; i++) {
      const tsDelta = view.getFloat64(offset);
      offset += 8;
      const xorValue = view.getFloat64(offset);
      offset += 8;

      const timestamp = prevTimestamp + tsDelta;
      const value = this.xorFloat64(xorValue, prevValue);

      points.push({ timestamp, value });

      prevTimestamp = timestamp;
      prevValue = value;
    }

    return points;
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * XOR two float64 values at the bit level
   */
  private xorFloat64(a: number, b: number): number {
    const bufA = new ArrayBuffer(8);
    const bufB = new ArrayBuffer(8);
    new DataView(bufA).setFloat64(0, a);
    new DataView(bufB).setFloat64(0, b);

    const u8A = new Uint8Array(bufA);
    const u8B = new Uint8Array(bufB);
    const result = new Uint8Array(8);

    for (let i = 0; i < 8; i++) {
      result[i] = u8A[i]! ^ u8B[i]!;
    }

    return new DataView(result.buffer).getFloat64(0);
  }
}

/**
 * Create a new GorillaCompressor instance
 */
export function createGorillaCompressor(): GorillaCompressor {
  return new GorillaCompressor();
}
