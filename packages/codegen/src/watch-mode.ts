/**
 * @pocket/codegen - Watch Mode
 *
 * File watcher that watches schema definition files and
 * regenerates code on changes using RxJS Subjects for events.
 *
 * @module @pocket/codegen
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Subject } from 'rxjs';

import type { Observable } from 'rxjs';

/**
 * Event emitted when a watched schema file changes.
 */
export interface WatchEvent {
  /** The type of file change */
  type: 'change' | 'add' | 'delete';
  /** Absolute path of the changed file */
  path: string;
  /** Paths of files generated in response to the change */
  generatedFiles: string[];
  /** Timestamp when the event was emitted */
  timestamp: number;
}

/**
 * Filesystem operations used by the watcher, injectable for testing.
 */
export interface WatchFs {
  /** Watch a directory for changes */
  watch: typeof fs.watch;
  /** Check if a file exists */
  existsSync: typeof fs.existsSync;
}

/**
 * Configuration for the watch mode.
 */
export interface WatchModeConfig {
  /** Glob pattern for schema files to watch */
  schemaGlob: string;
  /** Output directory for generated files */
  outputDir: string;
  /** List of generator names to run on change */
  generators: string[];
  /** Debounce interval in milliseconds (default: 300) */
  debounceMs?: number;
  /** Injectable filesystem operations (defaults to node:fs) */
  fs?: WatchFs;
}

/**
 * Handle returned by {@link createWatchMode}.
 */
export interface WatchModeHandle {
  /** Start watching for file changes */
  start(): void;
  /** Stop watching and clean up */
  stop(): void;
  /** Observable stream of watch events */
  onChange$: Observable<WatchEvent>;
  /** Whether the watcher is currently running */
  isRunning: boolean;
}

/**
 * Create a file watcher that regenerates code when schema files change.
 *
 * @param config - Watch mode configuration
 * @returns A handle to start/stop watching and observe events
 *
 * @example
 * ```typescript
 * const watcher = createWatchMode({
 *   schemaGlob: 'schemas/*.json',
 *   outputDir: './src/generated',
 *   generators: ['types', 'validation'],
 *   debounceMs: 500,
 * });
 *
 * watcher.onChange$.subscribe((event) => {
 *   console.log(`${event.type}: ${event.path}`);
 * });
 *
 * watcher.start();
 * ```
 */
export function createWatchMode(config: WatchModeConfig): WatchModeHandle {
  const { schemaGlob, outputDir, generators, debounceMs = 300 } = config;
  const fsOps: WatchFs = config.fs ?? { watch: fs.watch, existsSync: fs.existsSync };
  const subject = new Subject<WatchEvent>();
  let running = false;
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolve the directory to watch from the glob pattern. */
  function resolveWatchDir(): string {
    const globDir = path.dirname(schemaGlob);
    return path.resolve(globDir);
  }

  /** Emit a watch event through the subject. */
  function emitEvent(type: WatchEvent['type'], filePath: string): void {
    const generatedFiles = generators.map((g) =>
      path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}.${g}.ts`)
    );

    subject.next({
      type,
      path: filePath,
      generatedFiles,
      timestamp: Date.now(),
    });
  }

  /** Handle a raw fs event with debouncing. */
  function handleFsEvent(eventType: string, filename: string | null): void {
    if (!filename) return;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      const fullPath = path.resolve(resolveWatchDir(), filename);
      const watchEventType: WatchEvent['type'] =
        eventType === 'rename' ? (fsOps.existsSync(fullPath) ? 'add' : 'delete') : 'change';

      emitEvent(watchEventType, fullPath);
    }, debounceMs);
  }

  const handle: WatchModeHandle = {
    start(): void {
      if (running) return;
      running = true;

      const watchDir = resolveWatchDir();
      watcher = fsOps.watch(watchDir, { recursive: true }, handleFsEvent);
    },

    stop(): void {
      if (!running) return;
      running = false;

      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      if (watcher) {
        watcher.close();
        watcher = null;
      }

      subject.complete();
    },

    onChange$: subject.asObservable(),

    get isRunning(): boolean {
      return running;
    },
  };

  return handle;
}
