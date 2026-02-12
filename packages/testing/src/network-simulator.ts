import { BehaviorSubject } from 'rxjs';
import type { NetworkCondition, NetworkSimulator, NetworkSimulatorConfig, NetworkState } from './types.js';

const DEFAULT_LATENCY: Record<NetworkCondition, number> = {
  online: 0,
  offline: 0,
  slow: 3000,
  unreliable: 200,
  partitioned: 0,
};

const DEFAULT_PACKET_LOSS: Record<NetworkCondition, number> = {
  online: 0,
  offline: 1,
  slow: 0,
  unreliable: 0.3,
  partitioned: 1,
};

export function createNetworkSimulator(config: NetworkSimulatorConfig = {}): NetworkSimulator {
  const initialCondition = config.initialCondition ?? 'online';
  const baseLatency = config.latencyMs ?? DEFAULT_LATENCY[initialCondition];
  const basePacketLoss = config.packetLossRate ?? DEFAULT_PACKET_LOSS[initialCondition];

  let requestCount = 0;
  let droppedCount = 0;
  // Tracks which clients are isolated during partition simulation
  const partitioned: { clientIds: string[] } = { clientIds: [] };

  const state$ = new BehaviorSubject<NetworkState>({
    condition: initialCondition,
    latencyMs: baseLatency,
    packetLossRate: basePacketLoss,
    requestCount: 0,
    droppedCount: 0,
  });

  function updateState(partial: Partial<NetworkState>): void {
    state$.next({ ...state$.getValue(), ...partial });
  }

  function setCondition(condition: NetworkCondition): void {
    updateState({
      condition,
      latencyMs: DEFAULT_LATENCY[condition],
      packetLossRate: DEFAULT_PACKET_LOSS[condition],
    });
  }

  function getState(): NetworkState {
    return state$.getValue();
  }

  async function simulateRequest<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = getState();
    requestCount++;
    updateState({ requestCount });

    // Simulate packet loss
    if (currentState.packetLossRate > 0 && Math.random() < currentState.packetLossRate) {
      droppedCount++;
      updateState({ droppedCount });
      throw new Error(`Network request dropped (condition: ${currentState.condition})`);
    }

    // Simulate latency
    if (currentState.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, currentState.latencyMs));
    }

    return fn();
  }

  function simulateOffline(): void {
    setCondition('offline');
  }

  function simulateOnline(): void {
    setCondition('online');
  }

  function simulatePartition(clientIds: string[]): void {
    partitioned.clientIds = [...clientIds];
    setCondition('partitioned');
  }

  function simulateSlow(latencyMs: number): void {
    updateState({
      condition: 'slow',
      latencyMs,
      packetLossRate: 0,
    });
  }

  function reset(): void {
    requestCount = 0;
    droppedCount = 0;
    partitioned.clientIds = [];
    state$.next({
      condition: initialCondition,
      latencyMs: baseLatency,
      packetLossRate: basePacketLoss,
      requestCount: 0,
      droppedCount: 0,
    });
  }

  return {
    setCondition,
    getState,
    state$: state$.asObservable(),
    simulateRequest,
    simulateOffline,
    simulateOnline,
    simulatePartition,
    simulateSlow,
    reset,
  };
}
