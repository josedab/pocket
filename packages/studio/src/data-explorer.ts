/**
 * Data Explorer — enhanced data browsing, filtering, and
 * aggregation for Pocket Studio.
 */

export interface DataExplorerConfig {
  /** Maximum documents per page (default: 50) */
  pageSize?: number;
  /** Maximum export size (default: 10000) */
  maxExportSize?: number;
}

export interface DataPage {
  documents: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AggregationResult {
  field: string;
  type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';
  value: number | string | unknown[];
}

export interface FieldStats {
  field: string;
  type: string;
  nonNullCount: number;
  nullCount: number;
  distinctCount: number;
  minValue?: unknown;
  maxValue?: unknown;
  avgValue?: number;
  topValues?: { value: unknown; count: number }[];
}

/**
 * Enhanced data exploration with pagination, aggregation, and stats.
 */
export class DataExplorer {
  private readonly config: Required<DataExplorerConfig>;

  constructor(config: DataExplorerConfig = {}) {
    this.config = {
      pageSize: config.pageSize ?? 50,
      maxExportSize: config.maxExportSize ?? 10000,
    };
  }

  /**
   * Paginate through documents.
   */
  paginate(documents: Record<string, unknown>[], page: number): DataPage {
    const start = (page - 1) * this.config.pageSize;
    const slice = documents.slice(start, start + this.config.pageSize);

    return {
      documents: slice,
      total: documents.length,
      page,
      pageSize: this.config.pageSize,
      hasMore: start + this.config.pageSize < documents.length,
    };
  }

  /**
   * Compute field statistics for a collection.
   */
  computeFieldStats(documents: Record<string, unknown>[], field: string): FieldStats {
    const values: unknown[] = [];
    let nullCount = 0;
    const valueCounts = new Map<string, number>();

    for (const doc of documents) {
      const val = doc[field];
      if (val === null || val === undefined) {
        nullCount++;
      } else {
        values.push(val);
        const key = JSON.stringify(val);
        valueCounts.set(key, (valueCounts.get(key) ?? 0) + 1);
      }
    }

    const type = values.length > 0 ? typeof values[0] : 'unknown';
    const stats: FieldStats = {
      field,
      type,
      nonNullCount: values.length,
      nullCount,
      distinctCount: valueCounts.size,
    };

    // Numeric stats
    if (type === 'number') {
      const nums = values as number[];
      stats.minValue = Math.min(...nums);
      stats.maxValue = Math.max(...nums);
      stats.avgValue = nums.reduce((a, b) => a + b, 0) / nums.length;
    }

    // Top values (up to 5)
    const sorted = Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    stats.topValues = sorted.map(([k, count]) => ({
      value: JSON.parse(k) as unknown,
      count,
    }));

    return stats;
  }

  /**
   * Run a simple aggregation on a field.
   */
  aggregate(
    documents: Record<string, unknown>[],
    field: string,
    type: AggregationResult['type'],
  ): AggregationResult {
    const values = documents
      .map((d) => d[field])
      .filter((v) => v !== null && v !== undefined);

    let value: number | string | unknown[];

    switch (type) {
      case 'count':
        value = values.length;
        break;
      case 'distinct':
        value = [...new Set(values.map((v) => JSON.stringify(v)))].map(
          (s) => JSON.parse(s) as unknown,
        );
        break;
      case 'sum':
        value = values
          .filter((v): v is number => typeof v === 'number')
          .reduce((a, b) => a + b, 0);
        break;
      case 'avg': {
        const nums = values.filter((v): v is number => typeof v === 'number');
        value = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        break;
      }
      case 'min':
        value = values
          .filter((v): v is number => typeof v === 'number')
          .reduce((a, b) => Math.min(a, b), Infinity);
        break;
      case 'max':
        value = values
          .filter((v): v is number => typeof v === 'number')
          .reduce((a, b) => Math.max(a, b), -Infinity);
        break;
      default:
        value = 0;
    }

    return { field, type, value };
  }

  /**
   * Export documents as JSON string.
   */
  exportJSON(documents: Record<string, unknown>[]): string {
    const toExport = documents.slice(0, this.config.maxExportSize);
    return JSON.stringify(toExport, null, 2);
  }

  /**
   * Export documents as CSV string.
   */
  exportCSV(documents: Record<string, unknown>[]): string {
    if (documents.length === 0) return '';

    const toExport = documents.slice(0, this.config.maxExportSize);
    const allKeys = new Set<string>();
    for (const doc of toExport) {
      for (const key of Object.keys(doc)) {
        allKeys.add(key);
      }
    }
    const headers = Array.from(allKeys);

    const rows = [
      headers.join(','),
      ...toExport.map((doc) =>
        headers.map((h) => csvEscape(doc[h])).join(','),
      ),
    ];

    return rows.join('\n');
  }
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Create a DataExplorer instance.
 */
export function createDataExplorer(config?: DataExplorerConfig): DataExplorer {
  return new DataExplorer(config);
}
