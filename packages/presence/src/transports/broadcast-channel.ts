/**
 * BroadcastChannel transport for cross-tab presence
 */

import type { PresenceMessage, PresenceTransport } from '../types.js';

/**
 * Transport using BroadcastChannel API for cross-tab communication
 * Useful for local development and single-browser collaboration
 */
export class BroadcastChannelTransport implements PresenceTransport {
  private readonly channelName: string;
  private channel: BroadcastChannel | null = null;
  private readonly subscriptions = new Map<string, Set<(message: PresenceMessage) => void>>();
  private connected = false;

  constructor(channelName = 'pocket-presence') {
    this.channelName = channelName;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (typeof BroadcastChannel === 'undefined') {
      throw new Error('BroadcastChannel API is not available in this environment');
    }

    this.channel = new BroadcastChannel(this.channelName);

    this.channel.onmessage = (event: MessageEvent) => {
      const message = event.data as PresenceMessage;
      const callbacks = this.subscriptions.get(message.roomId);

      if (callbacks) {
        for (const callback of callbacks) {
          try {
            callback(message);
          } catch (error) {
            console.error('Error in presence message callback:', error);
          }
        }
      }
    };

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.channel) return;

    this.channel.close();
    this.channel = null;
    this.subscriptions.clear();
    this.connected = false;
  }

  async send(message: PresenceMessage): Promise<void> {
    if (!this.channel || !this.connected) {
      throw new Error('Transport not connected');
    }

    this.channel.postMessage(message);
  }

  subscribe(roomId: string, callback: (message: PresenceMessage) => void): () => void {
    if (!this.subscriptions.has(roomId)) {
      this.subscriptions.set(roomId, new Set());
    }

    const callbacks = this.subscriptions.get(roomId)!;
    callbacks.add(callback);

    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.subscriptions.delete(roomId);
      }
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Create a BroadcastChannel transport
 */
export function createBroadcastChannelTransport(channelName?: string): BroadcastChannelTransport {
  return new BroadcastChannelTransport(channelName);
}
