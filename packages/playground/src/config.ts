/**
 * @module @pocket/playground/config
 *
 * Configuration for the Pocket Playground.
 * Defines defaults and embed options for integrating the
 * playground into documentation or external sites.
 *
 * @example
 * ```typescript
 * const config = createPlaygroundConfig({ theme: 'dark' });
 * ```
 */
import type { PlaygroundFeatures, PlaygroundTheme } from './types.js';

export interface PlaygroundConfig {
  theme: PlaygroundTheme;
  features: PlaygroundFeatures;
}

export interface EmbedConfig extends PlaygroundConfig {
  width: string;
  height: string;
  initialTemplate?: string;
  hideHeader: boolean;
  hideToolbar: boolean;
}

const DEFAULT_THEME: PlaygroundTheme = {
  name: 'auto',
  fontFamily: 'monospace',
  fontSize: 14,
};

const DEFAULT_FEATURES: PlaygroundFeatures = {
  autoRun: false,
  showOutput: true,
  showTimings: true,
  readOnly: false,
  maxExecutionTimeMs: 5000,
};

export function createPlaygroundConfig(overrides?: Partial<PlaygroundConfig>): PlaygroundConfig {
  return {
    theme: { ...DEFAULT_THEME, ...overrides?.theme },
    features: { ...DEFAULT_FEATURES, ...overrides?.features },
  };
}

export function createEmbedConfig(overrides?: Partial<EmbedConfig>): EmbedConfig {
  const base = createPlaygroundConfig(overrides);
  return {
    ...base,
    width: overrides?.width ?? '100%',
    height: overrides?.height ?? '400px',
    initialTemplate: overrides?.initialTemplate,
    hideHeader: overrides?.hideHeader ?? false,
    hideToolbar: overrides?.hideToolbar ?? false,
  };
}
