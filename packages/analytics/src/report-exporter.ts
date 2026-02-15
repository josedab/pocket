/**
 * ReportExporter - Export analytics data in multiple formats for Pocket.
 *
 * Exports analytics data as CSV, JSON, HTML, or Markdown with configurable
 * filters, formatting, and scheduling support.
 *
 * @packageDocumentation
 * @module @pocket/analytics/report-exporter
 */

import { Subject, takeUntil, type Observable } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported export formats */
export type ExportFormat = 'csv' | 'json' | 'html' | 'markdown';

/** Configuration for a single export */
export interface ExportConfig {
  /** Output format */
  format: ExportFormat;
  /** Report title */
  title?: string;
  /** Report description */
  description?: string;
  /** Date range filter (Unix timestamps) */
  dateRange?: { start: number; end: number };
  /** Limit to specific event collections */
  collections?: string[];
  /** Limit to specific metric names */
  metrics?: string[];
  /** Include chart visualisation placeholders */
  includeCharts?: boolean;
  /** Include raw event data */
  includeRawData?: boolean;
  /** Maximum rows to export */
  maxRows?: number;
}

/** Result of an export operation */
export interface ExportResult {
  /** Unique export identifier */
  id: string;
  /** Format used */
  format: ExportFormat;
  /** Serialised content string */
  content: string;
  /** Content size in bytes */
  sizeBytes: number;
  /** Number of data rows exported */
  rowCount: number;
  /** Timestamp when the export was generated */
  generatedAt: number;
  /** Config used for this export */
  config: ExportConfig;
}

/** A scheduled recurring export */
export interface ScheduledExport {
  /** Unique schedule identifier */
  id: string;
  /** Export configuration */
  config: ExportConfig;
  /** Recurrence schedule */
  schedule: 'daily' | 'weekly' | 'monthly';
  /** Last execution timestamp */
  lastRunAt?: number;
  /** Next scheduled execution timestamp */
  nextRunAt: number;
  /** Whether the schedule is active */
  enabled: boolean;
  /** Delivery method */
  deliveryMethod?: 'download' | 'webhook';
  /** Webhook URL for remote delivery */
  webhookUrl?: string;
}

/** Events emitted by the exporter */
export interface ExportEvent {
  /** Event kind */
  type:
    | 'export-started'
    | 'export-completed'
    | 'export-failed'
    | 'schedule-created'
    | 'schedule-triggered';
  /** Event timestamp */
  timestamp: number;
  /** Related export ID */
  exportId?: string;
  /** Arbitrary event payload */
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

// ---------------------------------------------------------------------------
// ReportExporter
// ---------------------------------------------------------------------------

/**
 * Analytics report exporter with scheduling and multi-format support.
 *
 * @example
 * ```typescript
 * import { createReportExporter } from '@pocket/analytics';
 *
 * const exporter = createReportExporter();
 * const result = exporter.export(data, { format: 'csv', title: 'Weekly Report' });
 * console.log(result.content);
 * ```
 */
export class ReportExporter {
  private readonly destroy$ = new Subject<void>();
  private readonly events$$ = new Subject<ExportEvent>();
  private readonly history: ExportResult[] = [];
  private readonly schedules: ScheduledExport[] = [];
  private destroyed = false;

  /**
   * Observable stream of export events.
   */
  get events$(): Observable<ExportEvent> {
    return this.events$$.asObservable().pipe(takeUntil(this.destroy$));
  }

  // -----------------------------------------------------------------------
  // Core export
  // -----------------------------------------------------------------------

  /**
   * Export data in the requested format.
   *
   * @param data - Array of row objects to export
   * @param config - Export configuration
   * @returns An {@link ExportResult} containing the serialised content
   *
   * @example
   * ```typescript
   * const result = exporter.export(
   *   [{ event: 'click', count: 42 }],
   *   { format: 'json', title: 'Click Report' },
   * );
   * ```
   */
  export(data: Record<string, unknown>[], config: ExportConfig): ExportResult {
    const exportId = generateId();

    this.emitEvent({ type: 'export-started', timestamp: Date.now(), exportId });

    try {
      const rows = config.maxRows ? data.slice(0, config.maxRows) : data;

      let content: string;
      switch (config.format) {
        case 'csv':
          content = this.exportToCSV(rows);
          break;
        case 'json':
          content = this.exportToJSON(rows, { pretty: true });
          break;
        case 'html':
          content = this.exportToHTML(rows, { title: config.title, styles: true });
          break;
        case 'markdown':
          content = this.exportToMarkdown(rows, { title: config.title });
          break;
        default:
          content = this.exportToJSON(rows);
      }

      const result: ExportResult = {
        id: exportId,
        format: config.format,
        content,
        sizeBytes: new TextEncoder().encode(content).length,
        rowCount: rows.length,
        generatedAt: Date.now(),
        config,
      };

      this.history.push(result);
      this.emitEvent({ type: 'export-completed', timestamp: Date.now(), exportId });

      return result;
    } catch (error) {
      this.emitEvent({ type: 'export-failed', timestamp: Date.now(), exportId, data: error });
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Format-specific exporters
  // -----------------------------------------------------------------------

  /**
   * Export rows as a CSV string.
   *
   * @param data - Row objects
   * @param options - CSV options (delimiter, include headers)
   * @returns CSV string
   *
   * @example
   * ```typescript
   * const csv = exporter.exportToCSV([{ name: 'click', count: 5 }]);
   * // "name,count\nclick,5"
   * ```
   */
  exportToCSV(
    data: Record<string, unknown>[],
    options?: { delimiter?: string; headers?: boolean }
  ): string {
    if (data.length === 0) return '';

    const delimiter = options?.delimiter ?? ',';
    const includeHeaders = options?.headers ?? true;
    const headers = Object.keys(data[0]!);

    const lines: string[] = [];

    if (includeHeaders) {
      lines.push(headers.map((h) => this.escapeCSV(h)).join(delimiter));
    }

    for (const row of data) {
      const values = headers.map((h) => this.escapeCSV(row[h]));
      lines.push(values.join(delimiter));
    }

    return lines.join('\n');
  }

  /**
   * Export rows as a JSON string.
   *
   * @param data - Row objects
   * @param options - JSON options (pretty-print)
   * @returns JSON string
   *
   * @example
   * ```typescript
   * const json = exporter.exportToJSON([{ event: 'click' }], { pretty: true });
   * ```
   */
  exportToJSON(data: Record<string, unknown>[], options?: { pretty?: boolean }): string {
    return options?.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  }

  /**
   * Export rows as an HTML table.
   *
   * @param data - Row objects
   * @param options - HTML options (title, inline styles)
   * @returns HTML document string
   *
   * @example
   * ```typescript
   * const html = exporter.exportToHTML(data, { title: 'Report', styles: true });
   * ```
   */
  exportToHTML(
    data: Record<string, unknown>[],
    options?: { title?: string; styles?: boolean }
  ): string {
    if (data.length === 0) return '<html><body><p>No data</p></body></html>';

    const title = options?.title ?? 'Analytics Report';
    const headers = Object.keys(data[0]!);

    const style = options?.styles
      ? '<style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f4f4f4}tr:nth-child(even){background:#fafafa}</style>'
      : '';

    const headerRow = headers.map((h) => `<th>${this.formatValue(h)}</th>`).join('');
    const bodyRows = data
      .map(
        (row) => `<tr>${headers.map((h) => `<td>${this.formatValue(row[h])}</td>`).join('')}</tr>`
      )
      .join('\n');

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      `<meta charset="utf-8"><title>${title}</title>`,
      style,
      '</head>',
      '<body>',
      `<h1>${title}</h1>`,
      '<table>',
      `<thead><tr>${headerRow}</tr></thead>`,
      `<tbody>${bodyRows}</tbody>`,
      '</table>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  /**
   * Export rows as a Markdown table.
   *
   * @param data - Row objects
   * @param options - Markdown options (title heading)
   * @returns Markdown string
   *
   * @example
   * ```typescript
   * const md = exporter.exportToMarkdown(data, { title: 'Weekly Metrics' });
   * ```
   */
  exportToMarkdown(data: Record<string, unknown>[], options?: { title?: string }): string {
    if (data.length === 0)
      return options?.title ? `# ${options.title}\n\nNo data.\n` : 'No data.\n';

    const headers = Object.keys(data[0]!);
    const lines: string[] = [];

    if (options?.title) {
      lines.push(`# ${options.title}`, '');
    }

    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

    for (const row of data) {
      const values = headers.map((h) => this.formatValue(row[h]));
      lines.push(`| ${values.join(' | ')} |`);
    }

    lines.push('');
    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Scheduling
  // -----------------------------------------------------------------------

  /**
   * Schedule a recurring export.
   *
   * @param config - Export configuration to use on each run
   * @param schedule - Recurrence interval
   * @returns The created {@link ScheduledExport}
   *
   * @example
   * ```typescript
   * const scheduled = exporter.scheduleExport(
   *   { format: 'csv', title: 'Daily Events' },
   *   'daily',
   * );
   * ```
   */
  scheduleExport(config: ExportConfig, schedule: ScheduledExport['schedule']): ScheduledExport {
    const intervalMs = this.scheduleToMs(schedule);

    const entry: ScheduledExport = {
      id: generateId(),
      config,
      schedule,
      nextRunAt: Date.now() + intervalMs,
      enabled: true,
    };

    this.schedules.push(entry);
    this.emitEvent({ type: 'schedule-created', timestamp: Date.now(), exportId: entry.id });

    return entry;
  }

  /**
   * Cancel a scheduled export.
   *
   * @param id - Schedule identifier
   * @returns `true` if the schedule was found and removed
   *
   * @example
   * ```typescript
   * const removed = exporter.cancelScheduledExport(scheduled.id);
   * ```
   */
  cancelScheduledExport(id: string): boolean {
    const index = this.schedules.findIndex((s) => s.id === id);
    if (index === -1) return false;
    this.schedules.splice(index, 1);
    return true;
  }

  /**
   * Get all active scheduled exports.
   *
   * @returns Array of {@link ScheduledExport}
   */
  getScheduledExports(): ScheduledExport[] {
    return [...this.schedules];
  }

  /**
   * Get the history of completed exports.
   *
   * @returns Array of {@link ExportResult}
   */
  getExportHistory(): ExportResult[] {
    return [...this.history];
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Dispose the exporter and release resources.
   */
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.destroy$.next();
    this.destroy$.complete();
    this.events$$.complete();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private escapeCSV(value: unknown): string {
    const str = this.formatValue(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private scheduleToMs(schedule: ScheduledExport['schedule']): number {
    switch (schedule) {
      case 'daily':
        return 24 * 60 * 60 * 1000;
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000;
      case 'monthly':
        return 30 * 24 * 60 * 60 * 1000;
    }
  }

  private emitEvent(event: ExportEvent): void {
    this.events$$.next(event);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new ReportExporter instance.
 *
 * @returns A new {@link ReportExporter}
 *
 * @example
 * ```typescript
 * import { createReportExporter } from '@pocket/analytics';
 *
 * const exporter = createReportExporter();
 * const csv = exporter.exportToCSV([{ metric: 'dau', value: 1200 }]);
 * ```
 */
export function createReportExporter(): ReportExporter {
  return new ReportExporter();
}
