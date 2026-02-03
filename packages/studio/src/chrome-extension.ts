/**
 * ChromeExtensionBridge - Bridge between page context and Chrome DevTools extension panel.
 *
 * Manages communication with a Chrome DevTools extension for inspecting
 * Pocket databases from the DevTools panel using window.postMessage.
 *
 * @packageDocumentation
 * @module @pocket/studio/chrome-extension
 */

import { BehaviorSubject, Subject, takeUntil, type Observable } from 'rxjs';

/** Database-like interface for registration */
export interface RegisteredDatabase {
  /** Database name */
  name: string;
  /** Database instance reference */
  instance: unknown;
  /** Registration timestamp */
  registeredAt: number;
}

/** Message sent between extension and page */
export interface ChromeExtensionMessage {
  /** Message type */
  type: string;
  /** Source identifier */
  source: 'pocket-page' | 'pocket-devtools';
  /** Message payload */
  payload?: unknown;
  /** Timestamp */
  timestamp: number;
}

/** Configuration for the Chrome extension bridge */
export interface ChromeExtensionBridgeConfig {
  /** Message source identifier for outgoing messages. @default 'pocket-page' */
  messageSource?: 'pocket-page' | 'pocket-devtools';
  /** Enable debug logging. @default false */
  debug?: boolean;
}

/** Chrome extension manifest v3 structure */
export interface ChromeExtensionManifest {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  devtools_page: string;
  permissions: string[];
  icons: Record<string, string>;
  content_scripts?: {
    matches: string[];
    js: string[];
  }[];
}

/**
 * Manages communication between page context and Chrome DevTools extension panel.
 *
 * @example
 * ```typescript
 * import { createChromeExtensionBridge } from '@pocket/studio';
 *
 * const bridge = createChromeExtensionBridge();
 * bridge.register(db);
 * bridge.onMessage((msg) => console.log('From DevTools:', msg));
 * bridge.sendToPanel({ type: 'snapshot', payload: data });
 * ```
 */
export class ChromeExtensionBridge {
  private readonly config: Required<ChromeExtensionBridgeConfig>;
  private readonly destroy$ = new Subject<void>();
  private readonly databases = new Map<string, RegisteredDatabase>();
  private readonly databases$ = new BehaviorSubject<Map<string, RegisteredDatabase>>(new Map());
  private readonly messages$ = new Subject<ChromeExtensionMessage>();
  private readonly messageHandlers = new Set<(message: ChromeExtensionMessage) => void>();
  private readonly isExtensionContext: boolean;
  private readonly boundMessageListener: (event: MessageEvent) => void;
  private destroyed = false;

  constructor(config: ChromeExtensionBridgeConfig = {}) {
    this.config = {
      messageSource: config.messageSource ?? 'pocket-page',
      debug: config.debug ?? false,
    };

    this.isExtensionContext = this.detectExtensionContext();
    this.boundMessageListener = this.handleWindowMessage.bind(this);

    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('message', this.boundMessageListener);
    }

    this.log('ChromeExtensionBridge initialized', { isExtensionContext: this.isExtensionContext });
  }

  /**
   * Register a database instance for inspection.
   *
   * @param db - Database instance (must have a `name` property)
   */
  register(db: { name: string; [key: string]: unknown }): void {
    if (this.destroyed) return;

    const entry: RegisteredDatabase = {
      name: db.name,
      instance: db,
      registeredAt: Date.now(),
    };

    this.databases.set(db.name, entry);
    this.databases$.next(new Map(this.databases));
    this.sendToPanel({
      type: 'database-registered',
      source: this.config.messageSource,
      payload: { name: db.name },
      timestamp: Date.now(),
    });

    this.log('Registered database:', db.name);
  }

  /**
   * Remove a database from inspection.
   *
   * @param dbName - Name of the database to unregister
   * @returns Whether the database was found and removed
   */
  unregister(dbName: string): boolean {
    if (this.destroyed) return false;

    const removed = this.databases.delete(dbName);
    if (removed) {
      this.databases$.next(new Map(this.databases));
      this.sendToPanel({
        type: 'database-unregistered',
        source: this.config.messageSource,
        payload: { name: dbName },
        timestamp: Date.now(),
      });
      this.log('Unregistered database:', dbName);
    }
    return removed;
  }

  /**
   * List all registered databases.
   */
  getRegisteredDatabases(): RegisteredDatabase[] {
    return Array.from(this.databases.values());
  }

  /**
   * Observable of registered databases map.
   */
  get registeredDatabases$(): Observable<Map<string, RegisteredDatabase>> {
    return this.databases$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Listen for messages from the DevTools panel.
   *
   * @param handler - Callback invoked when a message is received
   * @returns Unsubscribe function
   */
  onMessage(handler: (message: ChromeExtensionMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Observable of incoming messages.
   */
  get incomingMessages$(): Observable<ChromeExtensionMessage> {
    return this.messages$.asObservable().pipe(takeUntil(this.destroy$));
  }

  /**
   * Send data to the DevTools panel via window.postMessage.
   *
   * @param message - Message to send
   */
  sendToPanel(message: ChromeExtensionMessage): void {
    if (this.destroyed) return;

    if (typeof globalThis.postMessage === 'function') {
      try {
        globalThis.postMessage(message, '*');
        this.log('Sent to panel:', message.type);
      } catch (error) {
        this.log('Failed to send to panel:', error);
      }
    }
  }

  /**
   * Whether the bridge is running in a Chrome extension context.
   */
  getIsExtensionContext(): boolean {
    return this.isExtensionContext;
  }

  /**
   * Destroy the bridge and clean up resources.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('message', this.boundMessageListener);
    }

    this.messageHandlers.clear();
    this.databases.clear();

    this.destroy$.next();
    this.destroy$.complete();
    this.databases$.complete();
    this.messages$.complete();

    this.log('ChromeExtensionBridge destroyed');
  }

  private handleWindowMessage(event: MessageEvent): void {
    if (this.destroyed) return;

    const data = event.data as ChromeExtensionMessage | undefined;
    if (!data || typeof data.type !== 'string' || !data.source) return;

    // Only process messages from the other side
    if (data.source === this.config.messageSource) return;

    this.messages$.next(data);
    for (const handler of this.messageHandlers) {
      try {
        handler(data);
      } catch (error) {
        this.log('Message handler error:', error);
      }
    }
  }

  private detectExtensionContext(): boolean {
    try {
      return (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as Record<string, unknown>).chrome === 'object' &&
        typeof ((globalThis as Record<string, unknown>).chrome as Record<string, unknown>)?.runtime === 'object'
      );
    } catch {
      return false;
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[ChromeExtensionBridge]', ...args);
    }
  }
}

/**
 * Create a new ChromeExtensionBridge instance.
 *
 * @param config - Optional bridge configuration
 * @returns A new ChromeExtensionBridge
 *
 * @example
 * ```typescript
 * import { createChromeExtensionBridge } from '@pocket/studio';
 *
 * const bridge = createChromeExtensionBridge();
 * bridge.register(db);
 * ```
 */
export function createChromeExtensionBridge(
  config?: ChromeExtensionBridgeConfig,
): ChromeExtensionBridge {
  return new ChromeExtensionBridge(config);
}

/**
 * Returns a Chrome extension manifest v3 JSON structure for the Pocket DevTools panel.
 *
 * @returns Chrome extension manifest v3 object
 *
 * @example
 * ```typescript
 * import { getChromeExtensionManifest } from '@pocket/studio';
 *
 * const manifest = getChromeExtensionManifest();
 * console.log(JSON.stringify(manifest, null, 2));
 * ```
 */
export function getChromeExtensionManifest(): ChromeExtensionManifest {
  return {
    manifest_version: 3,
    name: 'Pocket DevTools',
    version: '0.1.0',
    description: 'Chrome DevTools panel for inspecting Pocket databases',
    devtools_page: 'devtools.html',
    permissions: ['storage'],
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content-script.js'],
      },
    ],
  };
}
