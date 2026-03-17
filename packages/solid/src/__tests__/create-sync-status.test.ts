/**
 * Tests for createSyncStatus and createOnlineStatus primitives.
 *
 * Strategy: Mock solid-js onMount to run synchronously, provide a mock
 * SyncEngine with controllable observables.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Hoisted shared state                                              */
/* ------------------------------------------------------------------ */
const { cleanupFns, mountFns } = vi.hoisted(() => ({
  cleanupFns: [] as (() => void)[],
  mountFns: [] as (() => void)[],
}));

/* ------------------------------------------------------------------ */
/*  Mock solid-js                                                     */
/* ------------------------------------------------------------------ */
vi.mock('solid-js', () => ({
  createSignal: <T>(initial: T): [() => T, (v: T | ((p: T) => T)) => void] => {
    let value = initial;
    return [
      () => value,
      (v: unknown) => {
        value = typeof v === 'function' ? (v as (p: T) => T)(value) : (v as T);
      },
    ];
  },
  createEffect: (fn: () => void) => fn(),
  onCleanup: (fn: () => void) => {
    cleanupFns.push(fn);
  },
  onMount: (fn: () => void) => {
    mountFns.push(fn);
  },
}));

/* ------------------------------------------------------------------ */
/*  Import under test                                                 */
/* ------------------------------------------------------------------ */
import type { SyncEngine, SyncStats, SyncStatus } from '../primitives/create-sync-status.js';
import { createOnlineStatus, createSyncStatus } from '../primitives/create-sync-status.js';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                      */
/* ------------------------------------------------------------------ */
function createMockSyncEngine() {
  let statusCb: null | ((s: SyncStatus) => void) = null;
  let statsCb: null | ((s: SyncStats) => void) = null;
  const statusUnsub = vi.fn();
  const statsUnsub = vi.fn();

  const engine: SyncEngine & {
    _emitStatus: (s: SyncStatus) => void;
    _emitStats: (s: SyncStats) => void;
    _statusUnsub: typeof statusUnsub;
    _statsUnsub: typeof statsUnsub;
  } = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    forceSync: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({
      subscribe: vi.fn((cbs: { next: (s: SyncStatus) => void }) => {
        statusCb = cbs.next;
        return { unsubscribe: statusUnsub };
      }),
    }),
    getStats: vi.fn().mockReturnValue({
      subscribe: vi.fn((cbs: { next: (s: SyncStats) => void }) => {
        statsCb = cbs.next;
        return { unsubscribe: statsUnsub };
      }),
    }),
    _emitStatus: (s: SyncStatus) => statusCb?.(s),
    _emitStats: (s: SyncStats) => statsCb?.(s),
    _statusUnsub: statusUnsub,
    _statsUnsub: statsUnsub,
  };

  return engine;
}

const defaultStats: SyncStats = {
  pushCount: 0,
  pullCount: 0,
  conflictCount: 0,
  lastSyncAt: null,
  lastError: null,
};

function runMountFns() {
  for (const fn of mountFns) fn();
}

/* ================================================================== */
/*  createSyncStatus                                                  */
/* ================================================================== */
describe('createSyncStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFns.length = 0;
    mountFns.length = 0;
  });

  /* ---------- Initial state ---------- */

  it('should return all expected fields', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    expect(typeof result.status).toBe('function');
    expect(typeof result.isOnline).toBe('function');
    expect(typeof result.isSyncing).toBe('function');
    expect(typeof result.stats).toBe('function');
    expect(typeof result.forceSync).toBe('function');
    expect(typeof result.push).toBe('function');
    expect(typeof result.pull).toBe('function');
    expect(typeof result.start).toBe('function');
    expect(typeof result.stop).toBe('function');
    expect(typeof result.error).toBe('function');
  });

  it('should start with idle status', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    expect(result.status()).toBe('idle');
    expect(result.isSyncing()).toBe(false);
    expect(result.error()).toBe(null);
  });

  it('should start with default stats', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    expect(result.stats()).toEqual(defaultStats);
  });

  it('should report initial isOnline based on navigator.onLine', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    // In modern Node.js, navigator exists but navigator.onLine is undefined
    const expected = typeof navigator !== 'undefined' ? navigator.onLine : true;
    expect(result.isOnline()).toBe(expected);
  });

  /* ---------- Subscription on mount ---------- */

  it('should subscribe to status and stats on mount', () => {
    const engine = createMockSyncEngine();
    createSyncStatus(engine);

    runMountFns();

    expect(engine.getStatus).toHaveBeenCalled();
    expect(engine.getStats).toHaveBeenCalled();
  });

  it('should auto-start sync engine by default on mount', () => {
    const engine = createMockSyncEngine();
    createSyncStatus(engine);

    runMountFns();

    expect(engine.start).toHaveBeenCalled();
  });

  it('should not auto-start when autoStart=false', () => {
    const engine = createMockSyncEngine();
    createSyncStatus(engine, { autoStart: false });

    runMountFns();

    expect(engine.start).not.toHaveBeenCalled();
  });

  /* ---------- Status updates ---------- */

  it('should update status when observable emits', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);
    runMountFns();

    engine._emitStatus('syncing');
    expect(result.status()).toBe('syncing');
    expect(result.isSyncing()).toBe(true);
  });

  it('should clear isSyncing when status changes from syncing', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);
    runMountFns();

    engine._emitStatus('syncing');
    expect(result.isSyncing()).toBe(true);

    engine._emitStatus('idle');
    expect(result.isSyncing()).toBe(false);
  });

  it('should set error when status is error and stats have lastError', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);
    runMountFns();

    const syncError = new Error('sync failure');
    engine._emitStats({ ...defaultStats, lastError: syncError });
    engine._emitStatus('error');

    expect(result.status()).toBe('error');
    expect(result.error()).toBe(syncError);
  });

  it('should clear error when status changes from error to non-error', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);
    runMountFns();

    engine._emitStats({ ...defaultStats, lastError: new Error('old') });
    engine._emitStatus('error');
    expect(result.error()).toBeTruthy();

    engine._emitStatus('idle');
    expect(result.error()).toBe(null);
  });

  /* ---------- Stats updates ---------- */

  it('should update stats when observable emits', () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);
    runMountFns();

    const newStats: SyncStats = {
      pushCount: 5,
      pullCount: 3,
      conflictCount: 1,
      lastSyncAt: Date.now(),
      lastError: null,
    };
    engine._emitStats(newStats);

    expect(result.stats()).toEqual(newStats);
  });

  /* ---------- Sync operations ---------- */

  it('should call syncEngine.forceSync()', async () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    await result.forceSync();
    expect(engine.forceSync).toHaveBeenCalled();
  });

  it('should call syncEngine.push()', async () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    await result.push();
    expect(engine.push).toHaveBeenCalled();
  });

  it('should call syncEngine.pull()', async () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    await result.pull();
    expect(engine.pull).toHaveBeenCalled();
  });

  it('should call syncEngine.start()', async () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine, { autoStart: false });

    await result.start();
    expect(engine.start).toHaveBeenCalled();
  });

  it('should call syncEngine.stop()', async () => {
    const engine = createMockSyncEngine();
    const result = createSyncStatus(engine);

    await result.stop();
    expect(engine.stop).toHaveBeenCalled();
  });

  /* ---------- Error handling for operations ---------- */

  it('should set error when forceSync fails', async () => {
    const engine = createMockSyncEngine();
    (engine.forceSync as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('sync fail'));

    const result = createSyncStatus(engine);

    await expect(result.forceSync()).rejects.toThrow('sync fail');
    expect(result.error()!.message).toBe('sync fail');
  });

  it('should set error when push fails', async () => {
    const engine = createMockSyncEngine();
    (engine.push as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('push fail'));

    const result = createSyncStatus(engine);

    await expect(result.push()).rejects.toThrow('push fail');
    expect(result.error()!.message).toBe('push fail');
  });

  it('should set error when pull fails', async () => {
    const engine = createMockSyncEngine();
    (engine.pull as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('pull fail'));

    const result = createSyncStatus(engine);

    await expect(result.pull()).rejects.toThrow('pull fail');
    expect(result.error()!.message).toBe('pull fail');
  });

  it('should set error when start fails', async () => {
    const engine = createMockSyncEngine();
    (engine.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('start fail'));

    const result = createSyncStatus(engine);

    await expect(result.start()).rejects.toThrow('start fail');
    expect(result.error()!.message).toBe('start fail');
  });

  it('should set error when stop fails', async () => {
    const engine = createMockSyncEngine();
    (engine.stop as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stop fail'));

    const result = createSyncStatus(engine);

    await expect(result.stop()).rejects.toThrow('stop fail');
    expect(result.error()!.message).toBe('stop fail');
  });

  it('should wrap non-Error in Error on operation failure', async () => {
    const engine = createMockSyncEngine();
    (engine.forceSync as ReturnType<typeof vi.fn>).mockRejectedValue('raw error');

    const result = createSyncStatus(engine);

    await expect(result.forceSync()).rejects.toThrow();
    expect(result.error()).toBeInstanceOf(Error);
    expect(result.error()!.message).toBe('raw error');
  });

  it('should clear error before operation', async () => {
    const engine = createMockSyncEngine();
    (engine.forceSync as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce(undefined);

    const result = createSyncStatus(engine);

    await result.forceSync().catch(() => {});
    expect(result.error()).toBeTruthy();

    await result.forceSync();
    expect(result.error()).toBe(null);
  });

  /* ---------- Null sync engine ---------- */

  it('should handle null syncEngine gracefully', () => {
    const result = createSyncStatus(null);

    expect(result.status()).toBe('idle');
    expect(result.isSyncing()).toBe(false);
    expect(result.error()).toBe(null);
  });

  it('should not throw on operations with null syncEngine', async () => {
    const result = createSyncStatus(null);

    await expect(result.forceSync()).resolves.toBeUndefined();
    await expect(result.push()).resolves.toBeUndefined();
    await expect(result.pull()).resolves.toBeUndefined();
    await expect(result.start()).resolves.toBeUndefined();
    await expect(result.stop()).resolves.toBeUndefined();
  });

  it('should not subscribe on mount with null syncEngine', () => {
    createSyncStatus(null);
    runMountFns();
    // No errors should occur
  });

  /* ---------- Cleanup ---------- */

  it('should register cleanup function', () => {
    const engine = createMockSyncEngine();
    createSyncStatus(engine);
    expect(cleanupFns.length).toBeGreaterThan(0);
  });

  it('should unsubscribe from status and stats on cleanup', () => {
    const engine = createMockSyncEngine();
    createSyncStatus(engine);
    runMountFns();

    for (const fn of cleanupFns) fn();

    expect(engine._statusUnsub).toHaveBeenCalled();
    expect(engine._statsUnsub).toHaveBeenCalled();
  });

  /* ---------- Auto-start error handling ---------- */

  it('should set error when auto-start fails', async () => {
    const engine = createMockSyncEngine();
    (engine.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('autostart fail'));

    const result = createSyncStatus(engine, { autoStart: true });
    runMountFns();

    // Wait for the promise to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(result.error()!.message).toBe('autostart fail');
    expect(result.status()).toBe('error');
  });
});

/* ================================================================== */
/*  createOnlineStatus                                                */
/* ================================================================== */
describe('createOnlineStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupFns.length = 0;
    mountFns.length = 0;
  });

  it('should return an accessor function', () => {
    const isOnline = createOnlineStatus();
    expect(typeof isOnline).toBe('function');
  });

  it('should default to navigator.onLine value', () => {
    const isOnline = createOnlineStatus();
    const expected = typeof navigator !== 'undefined' ? navigator.onLine : true;
    expect(isOnline()).toBe(expected);
  });

  it('should register mount function', () => {
    createOnlineStatus();
    expect(mountFns.length).toBeGreaterThan(0);
  });

  it('should register cleanup function', () => {
    createOnlineStatus();
    expect(cleanupFns.length).toBeGreaterThan(0);
  });
});
