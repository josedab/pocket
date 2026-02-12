/**
 * @module @pocket/shared-worker/graceful-degradation
 *
 * Graceful degradation manager that detects available browser APIs
 * and selects the best coordination strategy. Falls back from
 * SharedWorker → BroadcastChannel → localStorage polling → direct mode.
 *
 * @example
 * ```typescript
 * const degradation = createGracefulDegradation({ databaseName: 'my-app' });
 * const strategy = degradation.detectBestStrategy();
 * console.log(`Using: ${strategy.mode}`); // 'shared-worker' | 'broadcast' | 'storage-events' | 'direct'
 * ```
 */

export type CoordinationMode = 'shared-worker' | 'broadcast' | 'storage-events' | 'direct';

export interface CoordinationStrategy {
  mode: CoordinationMode;
  supportsLeaderElection: boolean;
  supportsChangeNotification: boolean;
  supportsQueryDedup: boolean;
  estimatedLatencyMs: number;
}

export interface CapabilityReport {
  sharedWorker: boolean;
  broadcastChannel: boolean;
  localStorage: boolean;
  serviceWorker: boolean;
  webLocks: boolean;
  crossOriginIsolated: boolean;
}

export interface GracefulDegradationConfig {
  databaseName: string;
  preferredMode?: CoordinationMode;
  enableFallback?: boolean;
}

export interface GracefulDegradation {
  detectCapabilities(): CapabilityReport;
  detectBestStrategy(): CoordinationStrategy;
  getStrategyForMode(mode: CoordinationMode): CoordinationStrategy;
  isSupported(mode: CoordinationMode): boolean;
}

export function createGracefulDegradation(config: GracefulDegradationConfig): GracefulDegradation {
  const enableFallback = config.enableFallback ?? true;

  function detectCapabilities(): CapabilityReport {
    return {
      sharedWorker: typeof globalThis.SharedWorker !== 'undefined',
      broadcastChannel: typeof globalThis.BroadcastChannel !== 'undefined',
      localStorage: hasLocalStorage(),
      serviceWorker:
        typeof globalThis.navigator !== 'undefined' && 'serviceWorker' in globalThis.navigator,
      webLocks: typeof globalThis.navigator !== 'undefined' && 'locks' in globalThis.navigator,
      crossOriginIsolated:
        typeof globalThis.crossOriginIsolated !== 'undefined' && globalThis.crossOriginIsolated,
    };
  }

  function hasLocalStorage(): boolean {
    try {
      const testKey = '__pocket_test__';
      if (typeof globalThis.localStorage === 'undefined') return false;
      globalThis.localStorage.setItem(testKey, '1');
      globalThis.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  function getStrategyForMode(mode: CoordinationMode): CoordinationStrategy {
    switch (mode) {
      case 'shared-worker':
        return {
          mode: 'shared-worker',
          supportsLeaderElection: true,
          supportsChangeNotification: true,
          supportsQueryDedup: true,
          estimatedLatencyMs: 1,
        };
      case 'broadcast':
        return {
          mode: 'broadcast',
          supportsLeaderElection: true,
          supportsChangeNotification: true,
          supportsQueryDedup: true,
          estimatedLatencyMs: 2,
        };
      case 'storage-events':
        return {
          mode: 'storage-events',
          supportsLeaderElection: true,
          supportsChangeNotification: true,
          supportsQueryDedup: false,
          estimatedLatencyMs: 50,
        };
      case 'direct':
        return {
          mode: 'direct',
          supportsLeaderElection: false,
          supportsChangeNotification: false,
          supportsQueryDedup: false,
          estimatedLatencyMs: 0,
        };
    }
  }

  function isSupported(mode: CoordinationMode): boolean {
    const capabilities = detectCapabilities();
    switch (mode) {
      case 'shared-worker':
        return capabilities.sharedWorker;
      case 'broadcast':
        return capabilities.broadcastChannel;
      case 'storage-events':
        return capabilities.localStorage;
      case 'direct':
        return true;
    }
  }

  function detectBestStrategy(): CoordinationStrategy {
    // If preferred mode is specified and supported, use it
    if (config.preferredMode && isSupported(config.preferredMode)) {
      return getStrategyForMode(config.preferredMode);
    }

    if (!enableFallback && config.preferredMode) {
      return getStrategyForMode('direct');
    }

    // Cascade: SharedWorker → BroadcastChannel → localStorage → direct
    const capabilities = detectCapabilities();

    if (capabilities.sharedWorker) {
      return getStrategyForMode('shared-worker');
    }

    if (capabilities.broadcastChannel) {
      return getStrategyForMode('broadcast');
    }

    if (capabilities.localStorage) {
      return getStrategyForMode('storage-events');
    }

    return getStrategyForMode('direct');
  }

  return {
    detectCapabilities,
    detectBestStrategy,
    getStrategyForMode,
    isSupported,
  };
}
