/**
 * @module @pocket/shared-worker
 * Abstract broadcast adapter that works in both browser (BroadcastChannel) and Node (EventEmitter).
 */

import type { BroadcastAdapter, BroadcastMessage } from './types.js';

interface InternalAdapter {
  dispatch(message: BroadcastMessage): void;
  adapter: BroadcastAdapter;
}

/** Shared registry so multiple adapters on the same channel can communicate. */
const channelRegistryMap = new Map<string, Set<InternalAdapter>>();

/**
 * Creates a broadcast adapter using an in-process event dispatch for environments
 * without native BroadcastChannel support.
 */
export function createNodeBroadcastAdapter(channelName: string): BroadcastAdapter {
  const listeners = new Set<(message: BroadcastMessage) => void>();

  if (!channelRegistryMap.has(channelName)) {
    channelRegistryMap.set(channelName, new Set());
  }
  const channelAdapters = channelRegistryMap.get(channelName)!;

  const internal: InternalAdapter = {
    dispatch(message: BroadcastMessage): void {
      for (const listener of listeners) {
        listener(message);
      }
    },
    adapter: null!,
  };

  const self: BroadcastAdapter = {
    postMessage(message: BroadcastMessage): void {
      for (const entry of channelAdapters) {
        if (entry === internal) continue;
        entry.dispatch(message);
      }
    },

    onMessage(handler: (message: BroadcastMessage) => void): () => void {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },

    close(): void {
      listeners.clear();
      channelAdapters.delete(internal);
      if (channelAdapters.size === 0) {
        channelRegistryMap.delete(channelName);
      }
    },
  };

  internal.adapter = self;
  channelAdapters.add(internal);

  return self;
}

/**
 * Creates a broadcast adapter. In Node.js environments, uses an in-process
 * dispatch. In browsers, could be extended to use native BroadcastChannel.
 */
export function createBroadcastAdapter(channelName: string): BroadcastAdapter {
  return createNodeBroadcastAdapter(channelName);
}
