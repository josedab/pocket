import type { NetworkSimulatorConfig, SyncTestHarness, SyncTimeline, TestClient, TestServer, TimelineEvent } from './types.js';
import { createNetworkSimulator } from './network-simulator.js';

export interface SyncTestHarnessController {
  clients: TestClient[];
  server: TestServer;
  network: SyncTestHarness['network'];
  createClient(id: string): TestClient;
  createServer(): TestServer;
  syncAll(): Promise<void>;
  getTimeline(): SyncTimeline;
  reset(): void;
  destroy(): void;
}

export function createSyncTestHarness(config: NetworkSimulatorConfig = {}): SyncTestHarnessController {
  const network = createNetworkSimulator(config);
  const clients: TestClient[] = [];
  let server: TestServer = createServerInstance();
  const events: TimelineEvent[] = [];

  function addEvent(actor: string, type: string, data: unknown): void {
    events.push({
      timestamp: Date.now(),
      actor,
      type,
      data,
    });
  }

  function createClientInstance(id: string): TestClient {
    const data = new Map<string, unknown>();

    return {
      id,
      data,
      applyChange(change: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(change)) {
          data.set(key, value);
        }
        addEvent(id, 'change', change);
      },
      getData(): Map<string, unknown> {
        return data;
      },
    };
  }

  function createServerInstance(): TestServer {
    const data = new Map<string, unknown>();
    const changes: Record<string, unknown>[] = [];

    return {
      data,
      applyChange(change: Record<string, unknown>): void {
        for (const [key, value] of Object.entries(change)) {
          data.set(key, value);
        }
        changes.push(change);
        addEvent('server', 'change', change);
      },
      getData(): Map<string, unknown> {
        return data;
      },
      getChanges(): Record<string, unknown>[] {
        return [...changes];
      },
    };
  }

  function createClient(id: string): TestClient {
    const client = createClientInstance(id);
    clients.push(client);
    addEvent('harness', 'client-created', { clientId: id });
    return client;
  }

  function createServer(): TestServer {
    server = createServerInstance();
    addEvent('harness', 'server-created', {});
    return server;
  }

  async function syncAll(): Promise<void> {
    addEvent('harness', 'sync-start', { clientCount: clients.length });

    for (const client of clients) {
      // Push client data to server
      const clientData = client.getData();
      for (const [key, value] of clientData) {
        server.data.set(key, value);
      }
    }

    // Pull server data to all clients
    const serverData = server.getData();
    for (const client of clients) {
      for (const [key, value] of serverData) {
        client.data.set(key, value);
      }
    }

    addEvent('harness', 'sync-complete', { clientCount: clients.length });
  }

  function getTimeline(): SyncTimeline {
    return { events: [...events] };
  }

  function reset(): void {
    clients.length = 0;
    server = createServerInstance();
    events.length = 0;
    network.reset();
    addEvent('harness', 'reset', {});
  }

  function destroy(): void {
    clients.length = 0;
    events.length = 0;
    addEvent('harness', 'destroy', {});
  }

  return {
    clients,
    server,
    network,
    createClient,
    createServer,
    syncAll,
    getTimeline,
    reset,
    destroy,
  };
}
