import type { Observable } from 'rxjs';

// --- Network Simulation Types ---

export type NetworkCondition = 'online' | 'offline' | 'slow' | 'unreliable' | 'partitioned';

export interface NetworkSimulatorConfig {
  latencyMs?: number;
  packetLossRate?: number;
  bandwidthKbps?: number;
  initialCondition?: NetworkCondition;
}

export interface NetworkState {
  condition: NetworkCondition;
  latencyMs: number;
  packetLossRate: number;
  requestCount: number;
  droppedCount: number;
}

// --- Conflict Types ---

export interface ConflictScenario {
  documentId: string;
  localChanges: Record<string, unknown>;
  remoteChanges: Record<string, unknown>;
  expectedResolution?: Record<string, unknown>;
}

// --- Consistency Types ---

export interface ConsistencyCheckResult {
  consistent: boolean;
  differences: DataDifference[];
  checkedAt: number;
}

export interface DataDifference {
  collection: string;
  documentId: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
}

// --- Test Harness Types ---

export interface TestClient {
  id: string;
  data: Map<string, unknown>;
  applyChange(change: Record<string, unknown>): void;
  getData(): Map<string, unknown>;
}

export interface TestServer {
  data: Map<string, unknown>;
  applyChange(change: Record<string, unknown>): void;
  getData(): Map<string, unknown>;
  getChanges(): Record<string, unknown>[];
}

export interface SyncTestHarness {
  clients: TestClient[];
  server: TestServer;
  network: NetworkSimulator;
}

export interface NetworkSimulator {
  setCondition(condition: NetworkCondition): void;
  getState(): NetworkState;
  state$: Observable<NetworkState>;
  simulateRequest<T>(fn: () => Promise<T>): Promise<T>;
  simulateOffline(): void;
  simulateOnline(): void;
  simulatePartition(clientIds: string[]): void;
  simulateSlow(latencyMs: number): void;
  reset(): void;
}

// --- Timeline Types ---

export interface SyncTimeline {
  events: TimelineEvent[];
}

export interface TimelineEvent {
  timestamp: number;
  actor: string;
  type: string;
  data: unknown;
}
