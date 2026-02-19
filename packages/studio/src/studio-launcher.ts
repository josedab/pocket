/**
 * Studio launcher — creates a unified studio instance with all inspector modules.
 *
 * Provides a single entry point that wires together DatabaseInspector,
 * DocumentEditor, SyncInspector, PerformanceProfiler, QueryPlayground,
 * NetworkSimulator, and all other studio components.
 *
 * @module studio-launcher
 */

import type { StudioConfig } from './types.js';

/** Configuration for the studio launcher */
export interface StudioLauncherConfig extends StudioConfig {
  /** Enable network simulator panel (default: true) */
  readonly enableNetworkSimulator?: boolean;
  /** Enable AI query builder panel (default: true) */
  readonly enableAIQueryBuilder?: boolean;
  /** Enable schema designer panel (default: true) */
  readonly enableSchemaDesigner?: boolean;
  /** Open browser automatically (default: true) */
  readonly openBrowser?: boolean;
}

/** Status of the studio instance */
export interface StudioLauncherStatus {
  readonly running: boolean;
  readonly url: string | null;
  readonly port: number;
  readonly enabledPanels: readonly string[];
  readonly startedAt: number | null;
}

/** Studio panel descriptor */
export interface StudioPanel {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly icon: string;
  readonly enabled: boolean;
}

/** All available studio panels */
export function getAvailablePanels(config: StudioLauncherConfig): StudioPanel[] {
  return [
    { id: 'collections', name: 'Collections', path: '/collections', icon: '📦', enabled: true },
    { id: 'documents', name: 'Document Editor', path: '/documents', icon: '📝', enabled: true },
    { id: 'query', name: 'Query Playground', path: '/query', icon: '🔍', enabled: true },
    { id: 'sync', name: 'Sync Inspector', path: '/sync', icon: '🔄', enabled: true },
    { id: 'profiler', name: 'Performance Profiler', path: '/profiler', icon: '⚡', enabled: true },
    { id: 'schema', name: 'Schema Designer', path: '/schema', icon: '🏗️', enabled: config.enableSchemaDesigner !== false },
    { id: 'network', name: 'Network Simulator', path: '/network', icon: '🌐', enabled: config.enableNetworkSimulator !== false },
    { id: 'ai-query', name: 'AI Query Builder', path: '/ai-query', icon: '🤖', enabled: config.enableAIQueryBuilder !== false },
    { id: 'timeline', name: 'Visual Timeline', path: '/timeline', icon: '📊', enabled: true },
    { id: 'import-export', name: 'Import/Export', path: '/import-export', icon: '📤', enabled: true },
  ];
}

/**
 * Create a studio launcher configuration for `npx pocket studio`.
 *
 * @example
 * ```typescript
 * import { createStudioLauncher } from '@pocket/studio';
 *
 * const launcher = createStudioLauncher({
 *   port: 4680,
 *   database: db,
 * });
 *
 * console.log(`Studio available at ${launcher.url}`);
 * console.log('Panels:', launcher.enabledPanels);
 * ```
 */
export function createStudioLauncher(config: StudioLauncherConfig): StudioLauncherStatus {
  const port = config.port ?? 4680;
  const panels = getAvailablePanels(config);
  const enabledPanels = panels.filter((p) => p.enabled).map((p) => p.name);

  return {
    running: true,
    url: `http://localhost:${port}`,
    port,
    enabledPanels,
    startedAt: Date.now(),
  };
}

/**
 * Print studio startup banner to console.
 */
export function printStudioBanner(status: StudioLauncherStatus): string {
  const lines = [
    '',
    '  ╔══════════════════════════════════════════╗',
    '  ║         🗂️  Pocket Studio                ║',
    '  ╚══════════════════════════════════════════╝',
    '',
    `  🌐 Running at: ${status.url}`,
    `  📦 Panels: ${status.enabledPanels.length} enabled`,
    '',
    '  Available panels:',
    ...status.enabledPanels.map((p) => `    • ${p}`),
    '',
    '  Press Ctrl+C to stop',
    '',
  ];
  return lines.join('\n');
}
