/**
 * Browser compatibility layer for cross-tab synchronization.
 *
 * Detects available APIs (SharedWorker, BroadcastChannel, localStorage)
 * and provides graceful degradation with a unified messaging interface.
 *
 * @module browser-compat
 */

/** Available cross-tab transport mechanism */
export type CrossTabTransport = 'broadcast-channel' | 'shared-worker' | 'local-storage' | 'none';

/** Browser capability detection result */
export interface BrowserCapabilities {
  readonly broadcastChannel: boolean;
  readonly sharedWorker: boolean;
  readonly localStorage: boolean;
  readonly serviceWorker: boolean;
  readonly locks: boolean;
  readonly bestTransport: CrossTabTransport;
}

/** Detect available browser capabilities */
export function detectCapabilities(): BrowserCapabilities {
  const broadcastChannel = typeof globalThis.BroadcastChannel !== 'undefined';
  const sharedWorker = typeof globalThis.SharedWorker !== 'undefined';
  const localStorage = typeof globalThis.localStorage !== 'undefined';
  const serviceWorker = typeof globalThis.navigator !== 'undefined' &&
    'serviceWorker' in globalThis.navigator;
  const locks = typeof globalThis.navigator !== 'undefined' &&
    'locks' in globalThis.navigator;

  let bestTransport: CrossTabTransport = 'none';
  if (sharedWorker) bestTransport = 'shared-worker';
  else if (broadcastChannel) bestTransport = 'broadcast-channel';
  else if (localStorage) bestTransport = 'local-storage';

  return { broadcastChannel, sharedWorker, localStorage, serviceWorker, locks, bestTransport };
}

/** Unified cross-tab message sender interface */
export interface CrossTabSender {
  send(channel: string, data: unknown): void;
  subscribe(channel: string, handler: (data: unknown) => void): () => void;
  destroy(): void;
}

/** Create a BroadcastChannel-based sender */
function createBroadcastChannelSender(): CrossTabSender {
  const channels = new Map<string, BroadcastChannel>();
  const handlers = new Map<string, Set<(data: unknown) => void>>();

  return {
    send(channel, data) {
      let bc = channels.get(channel);
      if (!bc) {
        bc = new BroadcastChannel(channel);
        channels.set(channel, bc);
      }
      bc.postMessage(data);
    },
    subscribe(channel, handler) {
      let bc = channels.get(channel);
      if (!bc) {
        bc = new BroadcastChannel(channel);
        channels.set(channel, bc);
      }
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        bc.onmessage = (event) => {
          for (const h of handlers.get(channel) ?? []) h(event.data);
        };
      }
      set.add(handler);
      return () => { set?.delete(handler); };
    },
    destroy() {
      for (const bc of channels.values()) bc.close();
      channels.clear();
      handlers.clear();
    },
  };
}

/** Create a localStorage-based fallback sender (polling) */
function createLocalStorageSender(): CrossTabSender {
  const POLL_INTERVAL = 100;
  const PREFIX = '__pocket_crosstab_';
  const intervals = new Map<string, ReturnType<typeof setInterval>>();
  const lastValues = new Map<string, string>();

  return {
    send(channel, data) {
      try {
        localStorage.setItem(`${PREFIX}${channel}`, JSON.stringify({ data, ts: Date.now() }));
      } catch { /* storage full, ignore */ }
    },
    subscribe(channel, handler) {
      const key = `${PREFIX}${channel}`;
      const interval = setInterval(() => {
        try {
          const raw = localStorage.getItem(key);
          if (raw && raw !== lastValues.get(channel)) {
            lastValues.set(channel, raw);
            const parsed = JSON.parse(raw);
            handler(parsed.data);
          }
        } catch { /* ignore parse errors */ }
      }, POLL_INTERVAL);
      intervals.set(channel, interval);
      return () => {
        clearInterval(interval);
        intervals.delete(channel);
      };
    },
    destroy() {
      for (const interval of intervals.values()) clearInterval(interval);
      intervals.clear();
    },
  };
}

/** No-op sender for environments with no cross-tab support */
function createNoopSender(): CrossTabSender {
  return {
    send() {},
    subscribe() { return () => {}; },
    destroy() {},
  };
}

/**
 * Create a cross-tab sender with automatic capability detection and fallback.
 *
 * @example
 * ```typescript
 * import { createCompatSender, detectCapabilities } from '@pocket/cross-tab';
 *
 * const caps = detectCapabilities();
 * console.log(`Using ${caps.bestTransport} for cross-tab sync`);
 *
 * const sender = createCompatSender();
 * sender.send('pocket:changes', { collection: 'todos', op: 'insert' });
 *
 * const unsub = sender.subscribe('pocket:changes', (data) => {
 *   console.log('Change from another tab:', data);
 * });
 * ```
 */
export function createCompatSender(forceTransport?: CrossTabTransport): CrossTabSender {
  const transport = forceTransport ?? detectCapabilities().bestTransport;

  switch (transport) {
    case 'broadcast-channel':
      return createBroadcastChannelSender();
    case 'local-storage':
      return createLocalStorageSender();
    case 'shared-worker':
      // SharedWorker requires a separate worker script; fall back to BC
      return createBroadcastChannelSender();
    case 'none':
      return createNoopSender();
  }
}
