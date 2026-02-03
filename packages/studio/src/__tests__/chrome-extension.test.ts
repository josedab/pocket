import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChromeExtensionBridge,
  createChromeExtensionBridge,
  getChromeExtensionManifest,
  type ChromeExtensionMessage,
} from '../chrome-extension.js';

// Simulate window-like addEventListener/removeEventListener/postMessage on globalThis
type Listener = (event: MessageEvent) => void;
let messageListeners: Listener[] = [];

function simulatePostMessage(data: unknown): void {
  const event = new MessageEvent('message', { data });
  for (const listener of [...messageListeners]) {
    listener(event);
  }
}

describe('ChromeExtensionBridge', () => {
  let bridge: ChromeExtensionBridge;
  const origAddEventListener = globalThis.addEventListener;
  const origRemoveEventListener = globalThis.removeEventListener;
  const origPostMessage = (globalThis as Record<string, unknown>).postMessage as typeof globalThis.postMessage | undefined;

  beforeEach(() => {
    messageListeners = [];
    globalThis.addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'message') messageListeners.push(listener as Listener);
    }) as unknown as typeof globalThis.addEventListener;
    globalThis.removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'message') {
        messageListeners = messageListeners.filter((l) => l !== listener);
      }
    }) as unknown as typeof globalThis.removeEventListener;
    (globalThis as Record<string, unknown>).postMessage = vi.fn();
    bridge = new ChromeExtensionBridge();
  });

  afterEach(() => {
    bridge.destroy();
    globalThis.addEventListener = origAddEventListener;
    globalThis.removeEventListener = origRemoveEventListener;
    (globalThis as Record<string, unknown>).postMessage = origPostMessage as unknown as typeof globalThis.postMessage;
  });

  describe('register/unregister', () => {
    it('should register a database', () => {
      const db = { name: 'test-db' };
      bridge.register(db);

      const databases = bridge.getRegisteredDatabases();
      expect(databases).toHaveLength(1);
      expect(databases[0]!.name).toBe('test-db');
      expect(databases[0]!.instance).toBe(db);
      expect(databases[0]!.registeredAt).toBeGreaterThan(0);
    });

    it('should register multiple databases', () => {
      bridge.register({ name: 'db-1' });
      bridge.register({ name: 'db-2' });

      expect(bridge.getRegisteredDatabases()).toHaveLength(2);
    });

    it('should overwrite registration with same name', () => {
      const db1 = { name: 'test-db', version: 1 };
      const db2 = { name: 'test-db', version: 2 };
      bridge.register(db1);
      bridge.register(db2);

      const databases = bridge.getRegisteredDatabases();
      expect(databases).toHaveLength(1);
      expect((databases[0]!.instance as Record<string, unknown>).version).toBe(2);
    });

    it('should unregister a database', () => {
      bridge.register({ name: 'test-db' });
      expect(bridge.getRegisteredDatabases()).toHaveLength(1);

      const result = bridge.unregister('test-db');
      expect(result).toBe(true);
      expect(bridge.getRegisteredDatabases()).toHaveLength(0);
    });

    it('should return false when unregistering non-existent database', () => {
      const result = bridge.unregister('non-existent');
      expect(result).toBe(false);
    });

    it('should return empty list initially', () => {
      expect(bridge.getRegisteredDatabases()).toHaveLength(0);
    });
  });

  describe('getChromeExtensionManifest', () => {
    it('should return a valid manifest v3 structure', () => {
      const manifest = getChromeExtensionManifest();

      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe('Pocket DevTools');
      expect(typeof manifest.version).toBe('string');
      expect(typeof manifest.description).toBe('string');
      expect(manifest.devtools_page).toBe('devtools.html');
      expect(Array.isArray(manifest.permissions)).toBe(true);
      expect(manifest.icons).toBeDefined();
      expect(manifest.icons['16']).toBeDefined();
      expect(manifest.icons['48']).toBeDefined();
      expect(manifest.icons['128']).toBeDefined();
    });

    it('should include content_scripts', () => {
      const manifest = getChromeExtensionManifest();

      expect(manifest.content_scripts).toBeDefined();
      expect(manifest.content_scripts!).toHaveLength(1);
      expect(manifest.content_scripts![0]!.matches).toContain('<all_urls>');
      expect(manifest.content_scripts![0]!.js).toHaveLength(1);
    });
  });

  describe('message passing', () => {
    it('should call onMessage handler when receiving messages', () => {
      const handler = vi.fn();
      bridge.onMessage(handler);

      const message: ChromeExtensionMessage = {
        type: 'test',
        source: 'pocket-devtools',
        payload: { data: 'hello' },
        timestamp: Date.now(),
      };

      // Simulate incoming message from DevTools panel
      simulatePostMessage(message);

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should not call handler for messages from same source', () => {
      const handler = vi.fn();
      bridge.onMessage(handler);

      const message: ChromeExtensionMessage = {
        type: 'test',
        source: 'pocket-page', // same source as bridge default
        timestamp: Date.now(),
      };

      simulatePostMessage(message);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should ignore non-extension messages', () => {
      const handler = vi.fn();
      bridge.onMessage(handler);

      simulatePostMessage('random string');
      simulatePostMessage({ noType: true });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should unsubscribe from message handler', () => {
      const handler = vi.fn();
      const unsubscribe = bridge.onMessage(handler);
      unsubscribe();

      const message: ChromeExtensionMessage = {
        type: 'test',
        source: 'pocket-devtools',
        timestamp: Date.now(),
      };

      simulatePostMessage(message);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should clean up on destroy', () => {
      bridge.register({ name: 'test-db' });
      const handler = vi.fn();
      bridge.onMessage(handler);

      bridge.destroy();

      expect(bridge.getRegisteredDatabases()).toHaveLength(0);

      // Should not process messages after destroy
      const message: ChromeExtensionMessage = {
        type: 'test',
        source: 'pocket-devtools',
        timestamp: Date.now(),
      };
      simulatePostMessage(message);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not register after destroy', () => {
      bridge.destroy();
      bridge.register({ name: 'test-db' });
      expect(bridge.getRegisteredDatabases()).toHaveLength(0);
    });

    it('should be safe to call destroy multiple times', () => {
      bridge.destroy();
      expect(() => bridge.destroy()).not.toThrow();
    });
  });

  describe('factory', () => {
    it('should create bridge via factory', () => {
      const b = createChromeExtensionBridge();
      expect(b).toBeInstanceOf(ChromeExtensionBridge);
      b.destroy();
    });

    it('should accept config via factory', () => {
      const b = createChromeExtensionBridge({ debug: true });
      expect(b).toBeInstanceOf(ChromeExtensionBridge);
      b.destroy();
    });
  });
});
