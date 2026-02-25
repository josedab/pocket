/**
 * JSI Storage Engine — defines the native-bridge interface for
 * React Native TurboModules with C++ SQLite bindings.
 *
 * This module provides:
 * 1. TurboModule specification types for the native bridge
 * 2. JSI binding interface that C++ will implement
 * 3. Battery-aware sync scheduler
 * 4. Platform-specific storage adapter
 */

// ─── TurboModule Specification ───────────────────────────────────

/** The native module interface exposed to JavaScript via JSI. */
export interface PocketJSIModule {
  /** Execute a SQL statement synchronously (for reads). */
  executeSqlSync(dbName: string, sql: string, params: unknown[]): unknown[];
  /** Execute a SQL statement asynchronously (for writes). */
  executeSqlAsync(
    dbName: string,
    sql: string,
    params: unknown[]
  ): Promise<{ rowsAffected: number }>;
  /** Open a database (creates if not exists). */
  openDatabase(name: string, path?: string): boolean;
  /** Close a database. */
  closeDatabase(name: string): void;
  /** Check if a database exists. */
  databaseExists(name: string): boolean;
  /** Delete a database file. */
  deleteDatabase(name: string): boolean;
  /** Get database file size in bytes. */
  getDatabaseSize(name: string): number;
  /** Begin a transaction. */
  beginTransaction(name: string): void;
  /** Commit a transaction. */
  commitTransaction(name: string): void;
  /** Rollback a transaction. */
  rollbackTransaction(name: string): void;
}

/** TurboModule spec for React Native's codegen. */
export interface PocketTurboModuleSpec {
  readonly moduleName: 'PocketJSI';
  readonly methods: readonly {
    name: string;
    returnType: string;
    params: readonly { name: string; type: string }[];
    sync: boolean;
  }[];
}

/** Generate the TurboModule specification. */
export function getTurboModuleSpec(): PocketTurboModuleSpec {
  return {
    moduleName: 'PocketJSI',
    methods: [
      {
        name: 'executeSqlSync',
        returnType: 'Array<Object>',
        params: [
          { name: 'dbName', type: 'string' },
          { name: 'sql', type: 'string' },
          { name: 'params', type: 'Array<any>' },
        ],
        sync: true,
      },
      {
        name: 'executeSqlAsync',
        returnType: 'Promise<Object>',
        params: [
          { name: 'dbName', type: 'string' },
          { name: 'sql', type: 'string' },
          { name: 'params', type: 'Array<any>' },
        ],
        sync: false,
      },
      {
        name: 'openDatabase',
        returnType: 'boolean',
        params: [
          { name: 'name', type: 'string' },
          { name: 'path', type: 'string?' },
        ],
        sync: true,
      },
      {
        name: 'closeDatabase',
        returnType: 'void',
        params: [{ name: 'name', type: 'string' }],
        sync: true,
      },
      {
        name: 'databaseExists',
        returnType: 'boolean',
        params: [{ name: 'name', type: 'string' }],
        sync: true,
      },
      {
        name: 'deleteDatabase',
        returnType: 'boolean',
        params: [{ name: 'name', type: 'string' }],
        sync: true,
      },
      {
        name: 'getDatabaseSize',
        returnType: 'number',
        params: [{ name: 'name', type: 'string' }],
        sync: true,
      },
      {
        name: 'beginTransaction',
        returnType: 'void',
        params: [{ name: 'name', type: 'string' }],
        sync: true,
      },
      {
        name: 'commitTransaction',
        returnType: 'void',
        params: [{ name: 'name', type: 'string' }],
        sync: true,
      },
      {
        name: 'rollbackTransaction',
        returnType: 'void',
        params: [{ name: 'name', type: 'string' }],
        sync: true,
      },
    ],
  };
}

// ─── Battery-Aware Sync Scheduler ────────────────────────────────

/** Battery state from the device. */
export interface BatteryState {
  readonly level: number; // 0-1
  readonly isCharging: boolean;
  readonly isLowPowerMode: boolean;
}

/** Sync schedule decision. */
export interface SyncScheduleDecision {
  readonly shouldSync: boolean;
  readonly intervalMs: number;
  readonly reason: string;
  readonly mode: 'full' | 'incremental' | 'deferred';
}

/** Configuration for battery-aware scheduling. */
export interface BatterySchedulerConfig {
  /** Minimum battery level for full sync. Defaults to 0.2. */
  readonly minBatteryForFullSync?: number;
  /** Minimum battery level for incremental sync. Defaults to 0.1. */
  readonly minBatteryForIncrementalSync?: number;
  /** Sync interval when charging (ms). Defaults to 5000. */
  readonly chargingIntervalMs?: number;
  /** Sync interval on battery (ms). Defaults to 30000. */
  readonly batteryIntervalMs?: number;
  /** Sync interval in low power mode (ms). Defaults to 120000. */
  readonly lowPowerIntervalMs?: number;
}

/** Decide whether and how to sync based on battery state. */
export function decideSyncSchedule(
  battery: BatteryState,
  config?: BatterySchedulerConfig
): SyncScheduleDecision {
  const minFull = config?.minBatteryForFullSync ?? 0.2;
  const minIncremental = config?.minBatteryForIncrementalSync ?? 0.1;
  const chargingInterval = config?.chargingIntervalMs ?? 5000;
  const batteryInterval = config?.batteryIntervalMs ?? 30000;
  const lowPowerInterval = config?.lowPowerIntervalMs ?? 120000;

  if (battery.isCharging) {
    return {
      shouldSync: true,
      intervalMs: chargingInterval,
      reason: 'Device is charging',
      mode: 'full',
    };
  }

  if (battery.isLowPowerMode) {
    return {
      shouldSync: battery.level >= minIncremental,
      intervalMs: lowPowerInterval,
      reason: 'Low power mode active',
      mode: battery.level >= minIncremental ? 'incremental' : 'deferred',
    };
  }

  if (battery.level < minIncremental) {
    return {
      shouldSync: false,
      intervalMs: lowPowerInterval,
      reason: `Battery too low (${(battery.level * 100).toFixed(0)}%)`,
      mode: 'deferred',
    };
  }

  if (battery.level < minFull) {
    return {
      shouldSync: true,
      intervalMs: batteryInterval * 2,
      reason: `Low battery (${(battery.level * 100).toFixed(0)}%), incremental only`,
      mode: 'incremental',
    };
  }

  return {
    shouldSync: true,
    intervalMs: batteryInterval,
    reason: `Battery OK (${(battery.level * 100).toFixed(0)}%)`,
    mode: 'full',
  };
}

// ─── JSI Storage Adapter ─────────────────────────────────────────

/** Storage adapter that wraps JSI native module calls. */
export class JSIStorageAdapter {
  private readonly dbName: string;
  private jsiModule: PocketJSIModule | null = null;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  /** Connect to the native module. */
  connect(module: PocketJSIModule): void {
    this.jsiModule = module;
    this.jsiModule.openDatabase(this.dbName);
  }

  /** Execute a read query synchronously (via JSI). */
  querySync<T>(sql: string, params: unknown[] = []): T[] {
    if (!this.jsiModule) throw new Error('JSI module not connected');
    return this.jsiModule.executeSqlSync(this.dbName, sql, params) as T[];
  }

  /** Execute a write query asynchronously. */
  async execute(sql: string, params: unknown[] = []): Promise<number> {
    if (!this.jsiModule) throw new Error('JSI module not connected');
    const result = await this.jsiModule.executeSqlAsync(this.dbName, sql, params);
    return result.rowsAffected;
  }

  /** Run a set of operations in a transaction. */
  async transaction<R>(fn: () => Promise<R>): Promise<R> {
    if (!this.jsiModule) throw new Error('JSI module not connected');
    this.jsiModule.beginTransaction(this.dbName);
    try {
      const result = await fn();
      this.jsiModule.commitTransaction(this.dbName);
      return result;
    } catch (err) {
      this.jsiModule.rollbackTransaction(this.dbName);
      throw err;
    }
  }

  /** Close the database connection. */
  close(): void {
    this.jsiModule?.closeDatabase(this.dbName);
  }

  /** Get database size in bytes. */
  getSize(): number {
    return this.jsiModule?.getDatabaseSize(this.dbName) ?? 0;
  }
}

export function createJSIStorageAdapter(dbName: string): JSIStorageAdapter {
  return new JSIStorageAdapter(dbName);
}
