/**
 * @module ScenarioRunner
 *
 * Advanced cross-platform testing framework that combines network simulation,
 * conflict injection, and consistency checking into declarative test scenarios
 * with deterministic replay and assertion matchers.
 *
 * @example
 * ```typescript
 * const runner = createScenarioRunner();
 * runner.defineScenario({
 *   name: 'network-partition-recovery',
 *   steps: [
 *     { action: 'create-clients', count: 3 },
 *     { action: 'insert', client: 0, data: { key: 'a', value: 1 } },
 *     { action: 'network', condition: 'partitioned', clients: [1] },
 *     { action: 'insert', client: 1, data: { key: 'a', value: 2 } },
 *     { action: 'network', condition: 'online' },
 *     { action: 'sync' },
 *     { action: 'assert-consistency' },
 *   ],
 * });
 * const result = await runner.run('network-partition-recovery');
 * ```
 */

import { Subject } from 'rxjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Network condition profiles with realistic parameters */
export interface LatencyProfile {
  readonly name: string;
  readonly minLatencyMs: number;
  readonly maxLatencyMs: number;
  readonly jitterMs: number;
  readonly packetLossRate: number;
}

/** Predefined latency profiles */
export const LATENCY_PROFILES: Record<string, LatencyProfile> = {
  lan: { name: 'lan', minLatencyMs: 0, maxLatencyMs: 2, jitterMs: 1, packetLossRate: 0 },
  '4g': { name: '4g', minLatencyMs: 30, maxLatencyMs: 100, jitterMs: 20, packetLossRate: 0.01 },
  '3g': { name: '3g', minLatencyMs: 100, maxLatencyMs: 500, jitterMs: 50, packetLossRate: 0.05 },
  satellite: {
    name: 'satellite',
    minLatencyMs: 500,
    maxLatencyMs: 800,
    jitterMs: 100,
    packetLossRate: 0.03,
  },
  'lossy-wifi': {
    name: 'lossy-wifi',
    minLatencyMs: 5,
    maxLatencyMs: 50,
    jitterMs: 30,
    packetLossRate: 0.15,
  },
};

/** A single step in a test scenario */
export type ScenarioStep =
  | { readonly action: 'create-clients'; readonly count: number }
  | { readonly action: 'insert'; readonly client: number; readonly data: Record<string, unknown> }
  | {
      readonly action: 'update';
      readonly client: number;
      readonly key: string;
      readonly data: Record<string, unknown>;
    }
  | { readonly action: 'delete'; readonly client: number; readonly key: string }
  | {
      readonly action: 'network';
      readonly condition: 'online' | 'offline' | 'slow' | 'partitioned';
      readonly clients?: number[];
      readonly profile?: string;
    }
  | { readonly action: 'sync' }
  | { readonly action: 'wait'; readonly ms: number }
  | { readonly action: 'assert-consistency'; readonly timeoutMs?: number }
  | {
      readonly action: 'assert-value';
      readonly client: number;
      readonly key: string;
      readonly expected: unknown;
    }
  | { readonly action: 'assert-count'; readonly client: number; readonly expectedCount: number }
  | {
      readonly action: 'inject-conflict';
      readonly key: string;
      readonly localValue: unknown;
      readonly remoteValue: unknown;
    };

/** Scenario definition */
export interface ScenarioDefinition {
  readonly name: string;
  readonly description?: string;
  readonly steps: ScenarioStep[];
  readonly profile?: string;
}

/** Result of a single step */
export interface StepResult {
  readonly stepIndex: number;
  readonly action: string;
  readonly success: boolean;
  readonly error?: string;
  readonly durationMs: number;
}

/** Result of running a scenario */
export interface ScenarioResult {
  readonly name: string;
  readonly success: boolean;
  readonly steps: StepResult[];
  readonly totalDurationMs: number;
  readonly failedStep?: number;
}

/** Replay log for deterministic replay */
export interface ReplayLog {
  readonly scenarioName: string;
  readonly seed: number;
  readonly steps: {
    readonly stepIndex: number;
    readonly action: string;
    readonly randomValues: number[];
  }[];
}

/** Client in the test scenario */
interface ScenarioClient {
  readonly id: string;
  readonly data: Map<string, unknown>;
  networkCondition: 'online' | 'offline' | 'slow' | 'partitioned';
}

// ---------------------------------------------------------------------------
// Deterministic Random
// ---------------------------------------------------------------------------

class SeededRandom {
  private _seed: number;
  readonly recordedValues: number[] = [];

  constructor(seed: number) {
    this._seed = seed;
  }

  get seed(): number {
    return this._seed;
  }

  next(): number {
    this._seed = (this._seed * 16807 + 0) % 2147483647;
    const val = this._seed / 2147483647;
    this.recordedValues.push(val);
    return val;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// ---------------------------------------------------------------------------
// ScenarioRunner
// ---------------------------------------------------------------------------

export class ScenarioRunner {
  private readonly _scenarios = new Map<string, ScenarioDefinition>();
  private readonly _results: ScenarioResult[] = [];
  private readonly _onStep$ = new Subject<StepResult>();
  private readonly _destroy$ = new Subject<void>();

  /** Observable of step completions */
  readonly onStep$ = this._onStep$.asObservable();

  /** Define a test scenario */
  defineScenario(scenario: ScenarioDefinition): void {
    this._scenarios.set(scenario.name, scenario);
  }

  /** List all defined scenarios */
  getScenarios(): string[] {
    return [...this._scenarios.keys()];
  }

  /** Run a scenario by name */
  async run(name: string, seed?: number): Promise<ScenarioResult> {
    const scenario = this._scenarios.get(name);
    if (!scenario) {
      throw new Error(`Scenario "${name}" not found`);
    }

    const rng = new SeededRandom(seed ?? Date.now());
    const clients: ScenarioClient[] = [];
    const serverData = new Map<string, unknown>();
    const steps: StepResult[] = [];
    const t0 = Date.now();
    let failedStep: number | undefined;

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]!;
      const stepStart = Date.now();
      let success = true;
      let error: string | undefined;

      try {
        await this._executeStep(step, clients, serverData, rng);
      } catch (e) {
        success = false;
        error = e instanceof Error ? e.message : String(e);
        failedStep ??= i;
      }

      const result: StepResult = {
        stepIndex: i,
        action: step.action,
        success,
        error,
        durationMs: Date.now() - stepStart,
      };
      steps.push(result);
      this._onStep$.next(result);
    }

    const scenarioResult: ScenarioResult = {
      name,
      success: failedStep === undefined,
      steps,
      totalDurationMs: Date.now() - t0,
      failedStep,
    };

    this._results.push(scenarioResult);
    return scenarioResult;
  }

  /** Replay a scenario from a log */
  async replay(log: ReplayLog): Promise<ScenarioResult> {
    return this.run(log.scenarioName, log.seed);
  }

  /** Get all past results */
  getResults(): ScenarioResult[] {
    return [...this._results];
  }

  /** Get a latency profile by name */
  getProfile(name: string): LatencyProfile | undefined {
    return LATENCY_PROFILES[name];
  }

  /** Clean up */
  destroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
    this._onStep$.complete();
    this._scenarios.clear();
    this._results.length = 0;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async _executeStep(
    step: ScenarioStep,
    clients: ScenarioClient[],
    serverData: Map<string, unknown>,
    _rng: SeededRandom
  ): Promise<void> {
    switch (step.action) {
      case 'create-clients':
        for (let i = 0; i < step.count; i++) {
          clients.push({
            id: `client-${clients.length}`,
            data: new Map(),
            networkCondition: 'online',
          });
        }
        break;

      case 'insert': {
        const client = this._getClient(clients, step.client);
        for (const [key, value] of Object.entries(step.data)) {
          client.data.set(key, value);
        }
        break;
      }

      case 'update': {
        const client = this._getClient(clients, step.client);
        const existing = client.data.get(step.key);
        if (existing && typeof existing === 'object') {
          client.data.set(step.key, { ...(existing as Record<string, unknown>), ...step.data });
        } else {
          client.data.set(step.key, step.data);
        }
        break;
      }

      case 'delete': {
        const client = this._getClient(clients, step.client);
        client.data.delete(step.key);
        break;
      }

      case 'network': {
        const targetClients = step.clients
          ? step.clients.map((idx) => this._getClient(clients, idx))
          : clients;
        for (const c of targetClients) {
          c.networkCondition = step.condition;
        }
        break;
      }

      case 'sync': {
        // Simulate sync: online clients push/pull with server
        for (const client of clients) {
          if (client.networkCondition !== 'online') continue;
          // Push client -> server
          for (const [key, value] of client.data) {
            serverData.set(key, value);
          }
        }
        // Pull server -> online clients
        for (const client of clients) {
          if (client.networkCondition !== 'online') continue;
          for (const [key, value] of serverData) {
            client.data.set(key, value);
          }
        }
        break;
      }

      case 'wait':
        await new Promise((resolve) => setTimeout(resolve, step.ms));
        break;

      case 'assert-consistency': {
        const onlineClients = clients.filter((c) => c.networkCondition === 'online');
        if (onlineClients.length < 2) break;

        for (let i = 0; i < onlineClients.length - 1; i++) {
          const a = onlineClients[i]!;
          const b = onlineClients[i + 1]!;
          const keysA = [...a.data.keys()].sort();
          const keysB = [...b.data.keys()].sort();
          if (JSON.stringify(keysA) !== JSON.stringify(keysB)) {
            throw new Error(
              `Consistency check failed: ${a.id} keys [${keysA.join(',')}] ≠ ${b.id} keys [${keysB.join(',')}]`
            );
          }
          for (const key of keysA) {
            if (JSON.stringify(a.data.get(key)) !== JSON.stringify(b.data.get(key))) {
              throw new Error(`Consistency check failed: ${a.id}[${key}] ≠ ${b.id}[${key}]`);
            }
          }
        }
        break;
      }

      case 'assert-value': {
        const client = this._getClient(clients, step.client);
        const actual = client.data.get(step.key);
        if (JSON.stringify(actual) !== JSON.stringify(step.expected)) {
          throw new Error(
            `Value assertion failed on ${client.id}[${step.key}]: expected ${JSON.stringify(step.expected)}, got ${JSON.stringify(actual)}`
          );
        }
        break;
      }

      case 'assert-count': {
        const client = this._getClient(clients, step.client);
        if (client.data.size !== step.expectedCount) {
          throw new Error(
            `Count assertion failed on ${client.id}: expected ${step.expectedCount}, got ${client.data.size}`
          );
        }
        break;
      }

      case 'inject-conflict': {
        // Write different values on first two clients
        if (clients.length < 2) throw new Error('Need at least 2 clients for conflict injection');
        clients[0]!.data.set(step.key, step.localValue);
        clients[1]!.data.set(step.key, step.remoteValue);
        break;
      }
    }
  }

  private _getClient(clients: ScenarioClient[], index: number): ScenarioClient {
    const client = clients[index];
    if (!client) throw new Error(`Client index ${index} out of range (${clients.length} clients)`);
    return client;
  }
}

/** Factory function */
export function createScenarioRunner(): ScenarioRunner {
  return new ScenarioRunner();
}
