/**
 * In-memory transport for testing and single-tab scenarios.
 */
import type { CollabMessage, CollabTransport } from './types.js';

/**
 * MemoryTransport — in-process message bus for testing collaboration.
 * All instances sharing the same `MemoryTransportHub` can communicate.
 */
export class MemoryTransportHub {
  private readonly transports = new Set<MemoryTransport>();

  createTransport(): MemoryTransport {
    const transport = new MemoryTransport(this);
    return transport;
  }

  register(transport: MemoryTransport): void {
    this.transports.add(transport);
  }

  unregister(transport: MemoryTransport): void {
    this.transports.delete(transport);
  }

  broadcast(message: CollabMessage, sender: MemoryTransport): void {
    for (const transport of this.transports) {
      if (transport !== sender) {
        transport.receive(message);
      }
    }
  }
}

export class MemoryTransport implements CollabTransport {
  private handlers: ((message: CollabMessage) => void)[] = [];
  private connected = false;

  constructor(private readonly hub: MemoryTransportHub) {}

  send(message: CollabMessage): void {
    if (!this.connected) return;
    this.hub.broadcast(message, this);
  }

  onMessage(handler: (message: CollabMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.hub.register(this);
  }

  disconnect(): void {
    this.connected = false;
    this.hub.unregister(this);
  }

  receive(message: CollabMessage): void {
    for (const handler of this.handlers) {
      handler(message);
    }
  }
}

/**
 * Create a MemoryTransportHub for testing.
 */
export function createMemoryTransportHub(): MemoryTransportHub {
  return new MemoryTransportHub();
}
