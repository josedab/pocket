/**
 * Platform detection for cross-platform mobile applications.
 *
 * Detects the current runtime platform, device capabilities, and screen
 * characteristics. Provides platform-specific defaults for sync and storage.
 *
 * @module platform-detector
 *
 * @example
 * ```typescript
 * import { createPlatformDetector } from '@pocket/mobile';
 *
 * const detector = createPlatformDetector();
 * const info = detector.detect();
 *
 * console.log(info.platform); // 'ios' | 'android' | 'web' | 'expo'
 * console.log(info.capabilities.biometrics); // true
 * console.log(info.screen.orientation); // 'portrait'
 * ```
 */

import type {
  MobilePlatform,
  PlatformInfo,
  DeviceCapabilities,
  ScreenInfo,
  ScreenOrientation,
  ScreenSizeCategory,
  MobileSyncConfig,
  NetworkSyncStrategies,
} from './types.js';

// ────────────────────────────── Types ──────────────────────────────

/**
 * Configuration for {@link PlatformDetector}.
 */
export interface PlatformDetectorConfig {
  /** Override the detected platform */
  forcePlatform?: MobilePlatform;

  /** Override detected capabilities */
  capabilities?: Partial<DeviceCapabilities>;

  /** Override screen dimensions */
  screen?: Partial<Pick<ScreenInfo, 'width' | 'height'>>;
}

// ────────────────────────────── Constants ──────────────────────────────

const DEFAULT_CAPABILITIES: DeviceCapabilities = {
  biometrics: false,
  secureStorage: false,
  pushNotifications: false,
  backgroundFetch: false,
};

const DEFAULT_SCREEN: ScreenInfo = {
  width: 390,
  height: 844,
  orientation: 'portrait',
  sizeCategory: 'medium',
};

// ────────────────────────────── PlatformDetector ──────────────────────────────

/**
 * Detects the current mobile platform, device capabilities, and screen info.
 *
 * Provides a unified API for querying the runtime environment across
 * iOS, Android, Web, and Expo platforms.
 *
 * @example
 * ```typescript
 * const detector = new PlatformDetector();
 * const info = detector.detect();
 *
 * if (info.capabilities.biometrics) {
 *   console.log('Biometric auth available');
 * }
 * ```
 */
export class PlatformDetector {
  private readonly forcePlatform?: MobilePlatform;
  private readonly capabilityOverrides?: Partial<DeviceCapabilities>;
  private readonly screenOverrides?: Partial<Pick<ScreenInfo, 'width' | 'height'>>;

  constructor(config?: PlatformDetectorConfig) {
    this.forcePlatform = config?.forcePlatform;
    this.capabilityOverrides = config?.capabilities;
    this.screenOverrides = config?.screen;
  }

  // ────────────────────────────── Public API ──────────────────────────────

  /**
   * Detect the full platform info snapshot.
   *
   * @returns Current platform, capabilities, and screen info
   */
  detect(): PlatformInfo {
    const platform = this.detectPlatform();
    return {
      platform,
      capabilities: this.detectCapabilities(platform),
      screen: this.detectScreen(),
    };
  }

  /**
   * Detect the current mobile platform.
   *
   * @returns The detected or overridden platform
   */
  detectPlatform(): MobilePlatform {
    if (this.forcePlatform) {
      return this.forcePlatform;
    }

    if (typeof navigator === 'undefined') {
      return 'web';
    }

    const userAgent = navigator.userAgent || '';

    if (userAgent.includes('Expo')) {
      return 'expo';
    }

    if (/iPad|iPhone|iPod/.test(userAgent)) {
      return 'ios';
    }

    if (userAgent.includes('Android')) {
      return 'android';
    }

    return 'web';
  }

  /**
   * Detect device capabilities for the given platform.
   *
   * @param platform - The platform to detect capabilities for
   * @returns Merged capabilities with any overrides applied
   */
  detectCapabilities(platform: MobilePlatform): DeviceCapabilities {
    const defaults = this.getDefaultCapabilities(platform);
    return {
      ...defaults,
      ...this.capabilityOverrides,
    };
  }

  /**
   * Detect the current screen dimensions and orientation.
   *
   * @returns Screen info with size category
   */
  detectScreen(): ScreenInfo {
    const width = this.screenOverrides?.width ?? DEFAULT_SCREEN.width;
    const height = this.screenOverrides?.height ?? DEFAULT_SCREEN.height;
    const orientation: ScreenOrientation = width > height ? 'landscape' : 'portrait';
    const sizeCategory = this.categorizeScreenSize(Math.min(width, height));

    return { width, height, orientation, sizeCategory };
  }

  /**
   * Get platform-specific default sync configuration.
   *
   * @param platform - The target platform
   * @returns Default mobile sync config for the platform
   */
  getDefaultSyncConfig(platform: MobilePlatform): MobileSyncConfig {
    const strategies = this.getDefaultStrategies(platform);

    return {
      strategies,
      enablePushSync: platform !== 'web',
      enableBatteryAwareness: platform === 'ios' || platform === 'android',
      maxQueueSize: platform === 'web' ? 500 : 1000,
      persistQueue: true,
    };
  }

  // ────────────────────────────── Private helpers ──────────────────────────────

  private getDefaultCapabilities(platform: MobilePlatform): DeviceCapabilities {
    switch (platform) {
      case 'ios':
        return {
          biometrics: true,
          secureStorage: true,
          pushNotifications: true,
          backgroundFetch: true,
        };
      case 'android':
        return {
          biometrics: true,
          secureStorage: true,
          pushNotifications: true,
          backgroundFetch: true,
        };
      case 'expo':
        return {
          biometrics: true,
          secureStorage: true,
          pushNotifications: true,
          backgroundFetch: false,
        };
      case 'web':
        return { ...DEFAULT_CAPABILITIES };
    }
  }

  private categorizeScreenSize(shortSide: number): ScreenSizeCategory {
    if (shortSide < 360) return 'small';
    if (shortSide < 600) return 'medium';
    if (shortSide < 960) return 'large';
    return 'xlarge';
  }

  private getDefaultStrategies(platform: MobilePlatform): NetworkSyncStrategies {
    const isNative = platform === 'ios' || platform === 'android' || platform === 'expo';

    return {
      wifi: {
        enabled: true,
        batchSize: isNative ? 100 : 50,
        intervalMs: 30_000,
      },
      cellular: {
        enabled: true,
        batchSize: isNative ? 25 : 10,
        intervalMs: 120_000,
      },
      offline: {
        enabled: false,
        batchSize: 0,
        intervalMs: 0,
      },
    };
  }
}

// ────────────────────────────── Factory Function ──────────────────────────────

/**
 * Creates a new {@link PlatformDetector} instance.
 *
 * @param config - Optional configuration overrides
 * @returns A new PlatformDetector
 *
 * @example
 * ```typescript
 * const detector = createPlatformDetector({ forcePlatform: 'ios' });
 * const info = detector.detect();
 * console.log(info.platform); // 'ios'
 * ```
 */
export function createPlatformDetector(config?: PlatformDetectorConfig): PlatformDetector {
  return new PlatformDetector(config);
}
