/**
 * Downsampler with delta/run-length compression for time-series data.
 */

export interface DownsampleConfig {
  /** Target resolution in milliseconds */
  resolution: number;
  /** Aggregation function */
  aggregation: 'avg' | 'sum' | 'min' | 'max' | 'first' | 'last' | 'count';
}

export interface CompressedSeries {
  metric: string;
  startTime: number;
  resolution: number;
  /** Delta-encoded timestamps (first is absolute, rest are deltas) */
  timestamps: number[];
  /** Delta-encoded values (first is absolute, rest are deltas) */
  values: number[];
  /** Run-length encoded tags */
  tags?: { key: string; runs: { value: string; count: number }[] }[];
  pointCount: number;
  compressionRatio: number;
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  tags?: Record<string, string>;
}

/**
 * Downsamples and compresses time-series data.
 */
export class Downsampler {
  /** Downsample points to a lower resolution */
  downsample(points: TimeSeriesPoint[], config: DownsampleConfig): TimeSeriesPoint[] {
    if (points.length === 0) return [];

    // Sort by timestamp
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

    // Group into buckets
    const buckets = new Map<number, TimeSeriesPoint[]>();
    for (const point of sorted) {
      const bucketKey = Math.floor(point.timestamp / config.resolution) * config.resolution;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = [];
        buckets.set(bucketKey, bucket);
      }
      bucket.push(point);
    }

    // Aggregate each bucket
    const result: TimeSeriesPoint[] = [];
    for (const [timestamp, bucket] of buckets) {
      const value = this.aggregate(
        bucket.map((p) => p.value),
        config.aggregation
      );
      result.push({ timestamp, value, tags: bucket[0]?.tags });
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Delta-encode a series for compression */
  deltaEncode(points: TimeSeriesPoint[], metric: string, resolution = 0): CompressedSeries {
    if (points.length === 0) {
      return {
        metric,
        startTime: 0,
        resolution,
        timestamps: [],
        values: [],
        pointCount: 0,
        compressionRatio: 1,
      };
    }

    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

    // Delta-encode timestamps
    const deltaTimestamps: number[] = [sorted[0]!.timestamp];
    for (let i = 1; i < sorted.length; i++) {
      deltaTimestamps.push(sorted[i]!.timestamp - sorted[i - 1]!.timestamp);
    }

    // Delta-encode values
    const deltaValues: number[] = [sorted[0]!.value];
    for (let i = 1; i < sorted.length; i++) {
      deltaValues.push(sorted[i]!.value - sorted[i - 1]!.value);
    }

    // Run-length encode tags
    const tagKeys = new Set<string>();
    for (const p of sorted) {
      if (p.tags) Object.keys(p.tags).forEach((k) => tagKeys.add(k));
    }

    const rleTagsList: { key: string; runs: { value: string; count: number }[] }[] = [];
    for (const key of tagKeys) {
      const runs: { value: string; count: number }[] = [];
      let currentVal = sorted[0]!.tags?.[key] ?? '';
      let count = 1;

      for (let i = 1; i < sorted.length; i++) {
        const val = sorted[i]!.tags?.[key] ?? '';
        if (val === currentVal) {
          count++;
        } else {
          runs.push({ value: currentVal, count });
          currentVal = val;
          count = 1;
        }
      }
      runs.push({ value: currentVal, count });
      rleTagsList.push({ key, runs });
    }

    // Estimate compression ratio
    const originalSize = sorted.length * (8 + 8); // timestamp + value in bytes
    const compressedSize = deltaTimestamps.length * 4 + deltaValues.length * 4; // smaller deltas
    const compressionRatio = originalSize / Math.max(compressedSize, 1);

    return {
      metric,
      startTime: sorted[0]!.timestamp,
      resolution,
      timestamps: deltaTimestamps,
      values: deltaValues,
      tags: rleTagsList.length > 0 ? rleTagsList : undefined,
      pointCount: sorted.length,
      compressionRatio,
    };
  }

  /** Decode a delta-encoded series back to points */
  deltaDecode(series: CompressedSeries): TimeSeriesPoint[] {
    if (series.pointCount === 0) return [];

    // Reconstruct timestamps
    const timestamps: number[] = [series.timestamps[0]!];
    for (let i = 1; i < series.timestamps.length; i++) {
      timestamps.push(timestamps[i - 1]! + series.timestamps[i]!);
    }

    // Reconstruct values
    const values: number[] = [series.values[0]!];
    for (let i = 1; i < series.values.length; i++) {
      values.push(values[i - 1]! + series.values[i]!);
    }

    // Reconstruct tags from RLE
    const tagArrays = new Map<string, string[]>();
    if (series.tags) {
      for (const tagDef of series.tags) {
        const expanded: string[] = [];
        for (const run of tagDef.runs) {
          for (let i = 0; i < run.count; i++) {
            expanded.push(run.value);
          }
        }
        tagArrays.set(tagDef.key, expanded);
      }
    }

    const points: TimeSeriesPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const tags: Record<string, string> = {};
      for (const [key, vals] of tagArrays) {
        if (i < vals.length && vals[i]) {
          tags[key] = vals[i]!;
        }
      }

      points.push({
        timestamp: timestamps[i]!,
        value: values[i]!,
        tags: Object.keys(tags).length > 0 ? tags : undefined,
      });
    }

    return points;
  }

  private aggregate(values: number[], fn: DownsampleConfig['aggregation']): number {
    if (values.length === 0) return 0;
    switch (fn) {
      case 'avg':
        return values.reduce((a, b) => a + b, 0) / values.length;
      case 'sum':
        return values.reduce((a, b) => a + b, 0);
      case 'min':
        return Math.min(...values);
      case 'max':
        return Math.max(...values);
      case 'first':
        return values[0]!;
      case 'last':
        return values[values.length - 1]!;
      case 'count':
        return values.length;
    }
  }
}

export function createDownsampler(): Downsampler {
  return new Downsampler();
}
