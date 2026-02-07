import { describe, it, expect } from 'vitest';
import { createPlatformDetector, PlatformDetector } from '../platform-detector.js';

describe('PlatformDetector', () => {
  describe('createPlatformDetector', () => {
    it('returns a PlatformDetector instance', () => {
      const detector = createPlatformDetector();
      expect(detector).toBeInstanceOf(PlatformDetector);
    });

    it('accepts optional config', () => {
      const detector = createPlatformDetector({ forcePlatform: 'ios' });
      expect(detector).toBeInstanceOf(PlatformDetector);
    });
  });

  describe('detect', () => {
    it('returns PlatformInfo with platform, capabilities, and screen', () => {
      const detector = createPlatformDetector({ forcePlatform: 'ios' });
      const info = detector.detect();

      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('capabilities');
      expect(info).toHaveProperty('screen');
    });

    it('returns the forced platform', () => {
      const detector = createPlatformDetector({ forcePlatform: 'android' });
      const info = detector.detect();
      expect(info.platform).toBe('android');
    });
  });

  describe('detectPlatform', () => {
    it('returns forced platform when configured', () => {
      const detector = createPlatformDetector({ forcePlatform: 'ios' });
      expect(detector.detectPlatform()).toBe('ios');
    });

    it('returns "web" when navigator is undefined', () => {
      const detector = createPlatformDetector();
      expect(detector.detectPlatform()).toBe('web');
    });

    it.each(['ios', 'android', 'web', 'expo'] as const)(
      'returns "%s" when forced',
      (platform) => {
        const detector = createPlatformDetector({ forcePlatform: platform });
        expect(detector.detectPlatform()).toBe(platform);
      },
    );
  });

  describe('detectCapabilities', () => {
    it('returns all true capabilities for ios', () => {
      const detector = createPlatformDetector();
      const caps = detector.detectCapabilities('ios');
      expect(caps).toEqual({
        biometrics: true,
        secureStorage: true,
        pushNotifications: true,
        backgroundFetch: true,
      });
    });

    it('returns all true capabilities for android', () => {
      const detector = createPlatformDetector();
      const caps = detector.detectCapabilities('android');
      expect(caps).toEqual({
        biometrics: true,
        secureStorage: true,
        pushNotifications: true,
        backgroundFetch: true,
      });
    });

    it('returns all false capabilities for web', () => {
      const detector = createPlatformDetector();
      const caps = detector.detectCapabilities('web');
      expect(caps).toEqual({
        biometrics: false,
        secureStorage: false,
        pushNotifications: false,
        backgroundFetch: false,
      });
    });

    it('returns expo capabilities (no backgroundFetch)', () => {
      const detector = createPlatformDetector();
      const caps = detector.detectCapabilities('expo');
      expect(caps).toEqual({
        biometrics: true,
        secureStorage: true,
        pushNotifications: true,
        backgroundFetch: false,
      });
    });

    it('applies capability overrides', () => {
      const detector = createPlatformDetector({
        capabilities: { biometrics: false },
      });
      const caps = detector.detectCapabilities('ios');
      expect(caps.biometrics).toBe(false);
      expect(caps.secureStorage).toBe(true);
    });
  });

  describe('detectScreen', () => {
    it('returns default screen info', () => {
      const detector = createPlatformDetector();
      const screen = detector.detectScreen();
      expect(screen).toEqual({
        width: 390,
        height: 844,
        orientation: 'portrait',
        sizeCategory: 'medium',
      });
    });

    it('returns landscape when width > height', () => {
      const detector = createPlatformDetector({
        screen: { width: 844, height: 390 },
      });
      const screen = detector.detectScreen();
      expect(screen.orientation).toBe('landscape');
    });

    it('categorizes small screens (short side < 360)', () => {
      const detector = createPlatformDetector({
        screen: { width: 320, height: 480 },
      });
      expect(detector.detectScreen().sizeCategory).toBe('small');
    });

    it('categorizes medium screens (short side 360-599)', () => {
      const detector = createPlatformDetector({
        screen: { width: 400, height: 800 },
      });
      expect(detector.detectScreen().sizeCategory).toBe('medium');
    });

    it('categorizes large screens (short side 600-959)', () => {
      const detector = createPlatformDetector({
        screen: { width: 768, height: 1024 },
      });
      expect(detector.detectScreen().sizeCategory).toBe('large');
    });

    it('categorizes xlarge screens (short side >= 960)', () => {
      const detector = createPlatformDetector({
        screen: { width: 1024, height: 1366 },
      });
      expect(detector.detectScreen().sizeCategory).toBe('xlarge');
    });
  });

  describe('getDefaultSyncConfig', () => {
    it('returns config with pushSync disabled for web', () => {
      const detector = createPlatformDetector();
      const config = detector.getDefaultSyncConfig('web');
      expect(config.enablePushSync).toBe(false);
      expect(config.enableBatteryAwareness).toBe(false);
      expect(config.maxQueueSize).toBe(500);
      expect(config.persistQueue).toBe(true);
    });

    it('returns config with pushSync enabled for ios', () => {
      const detector = createPlatformDetector();
      const config = detector.getDefaultSyncConfig('ios');
      expect(config.enablePushSync).toBe(true);
      expect(config.enableBatteryAwareness).toBe(true);
      expect(config.maxQueueSize).toBe(1000);
    });

    it('returns config with pushSync enabled for android', () => {
      const detector = createPlatformDetector();
      const config = detector.getDefaultSyncConfig('android');
      expect(config.enablePushSync).toBe(true);
      expect(config.enableBatteryAwareness).toBe(true);
      expect(config.maxQueueSize).toBe(1000);
    });

    it('returns config with pushSync enabled but no battery awareness for expo', () => {
      const detector = createPlatformDetector();
      const config = detector.getDefaultSyncConfig('expo');
      expect(config.enablePushSync).toBe(true);
      expect(config.enableBatteryAwareness).toBe(false);
      expect(config.maxQueueSize).toBe(1000);
    });

    it('returns native batch sizes for ios', () => {
      const detector = createPlatformDetector();
      const config = detector.getDefaultSyncConfig('ios');
      expect(config.strategies.wifi.batchSize).toBe(100);
      expect(config.strategies.cellular.batchSize).toBe(25);
      expect(config.strategies.offline.enabled).toBe(false);
    });

    it('returns smaller batch sizes for web', () => {
      const detector = createPlatformDetector();
      const config = detector.getDefaultSyncConfig('web');
      expect(config.strategies.wifi.batchSize).toBe(50);
      expect(config.strategies.cellular.batchSize).toBe(10);
    });
  });
});
