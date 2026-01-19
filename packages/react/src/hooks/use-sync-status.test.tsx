import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncStatus, useOnlineStatus, type SyncEngine, type SyncStats } from './use-sync-status.js';
import { Subject } from 'rxjs';

// Create mock sync engine
function createMockSyncEngine() {
  const statusSubject = new Subject<'idle' | 'syncing' | 'error' | 'offline'>();
  const statsSubject = new Subject<SyncStats>();

  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    forceSync: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    pull: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue(statusSubject.asObservable()),
    getStats: vi.fn().mockReturnValue(statsSubject.asObservable()),
    // Test helpers
    _statusSubject: statusSubject,
    _statsSubject: statsSubject,
  } as unknown as SyncEngine & {
    _statusSubject: Subject<'idle' | 'syncing' | 'error' | 'offline'>;
    _statsSubject: Subject<SyncStats>;
  };
}

describe('useSyncStatus', () => {
  let mockSyncEngine: ReturnType<typeof createMockSyncEngine>;

  beforeEach(() => {
    mockSyncEngine = createMockSyncEngine();
    vi.clearAllMocks();
  });

  it('should start with idle status', () => {
    const TestComponent = () => {
      const { status, isSyncing } = useSyncStatus(mockSyncEngine);
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="syncing">{String(isSyncing)}</span>
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('syncing')).toHaveTextContent('false');
  });

  it('should auto-start by default', async () => {
    const TestComponent = () => {
      useSyncStatus(mockSyncEngine);
      return null;
    };

    render(<TestComponent />);

    await waitFor(() => {
      expect(mockSyncEngine.start).toHaveBeenCalled();
    });
  });

  it('should not auto-start when autoStart is false', async () => {
    const TestComponent = () => {
      useSyncStatus(mockSyncEngine, { autoStart: false });
      return null;
    };

    render(<TestComponent />);

    // Give some time to ensure start is not called
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockSyncEngine.start).not.toHaveBeenCalled();
  });

  it('should update status from observable', async () => {
    const TestComponent = () => {
      const { status, isSyncing } = useSyncStatus(mockSyncEngine);
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="syncing">{String(isSyncing)}</span>
        </div>
      );
    };

    render(<TestComponent />);

    act(() => {
      mockSyncEngine._statusSubject.next('syncing');
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('syncing');
      expect(screen.getByTestId('syncing')).toHaveTextContent('true');
    });
  });

  it('should update stats from observable', async () => {
    const TestComponent = () => {
      const { stats } = useSyncStatus(mockSyncEngine);
      return (
        <div>
          <span data-testid="pushCount">{stats.pushCount}</span>
          <span data-testid="pullCount">{stats.pullCount}</span>
          <span data-testid="conflictCount">{stats.conflictCount}</span>
        </div>
      );
    };

    render(<TestComponent />);

    act(() => {
      mockSyncEngine._statsSubject.next({
        pushCount: 5,
        pullCount: 10,
        conflictCount: 2,
        lastSyncAt: Date.now(),
        lastError: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('pushCount')).toHaveTextContent('5');
      expect(screen.getByTestId('pullCount')).toHaveTextContent('10');
      expect(screen.getByTestId('conflictCount')).toHaveTextContent('2');
    });
  });

  it('should call forceSync', async () => {
    let forceSyncFn: (() => Promise<void>) | null = null;

    const TestComponent = () => {
      const { forceSync } = useSyncStatus(mockSyncEngine);
      forceSyncFn = forceSync;
      return null;
    };

    render(<TestComponent />);

    await act(async () => {
      await forceSyncFn!();
    });

    expect(mockSyncEngine.forceSync).toHaveBeenCalled();
  });

  it('should call push', async () => {
    let pushFn: (() => Promise<void>) | null = null;

    const TestComponent = () => {
      const { push } = useSyncStatus(mockSyncEngine);
      pushFn = push;
      return null;
    };

    render(<TestComponent />);

    await act(async () => {
      await pushFn!();
    });

    expect(mockSyncEngine.push).toHaveBeenCalled();
  });

  it('should call pull', async () => {
    let pullFn: (() => Promise<void>) | null = null;

    const TestComponent = () => {
      const { pull } = useSyncStatus(mockSyncEngine);
      pullFn = pull;
      return null;
    };

    render(<TestComponent />);

    await act(async () => {
      await pullFn!();
    });

    expect(mockSyncEngine.pull).toHaveBeenCalled();
  });

  it('should call start', async () => {
    let startFn: (() => Promise<void>) | null = null;

    const TestComponent = () => {
      const { start } = useSyncStatus(mockSyncEngine, { autoStart: false });
      startFn = start;
      return null;
    };

    render(<TestComponent />);

    await act(async () => {
      await startFn!();
    });

    expect(mockSyncEngine.start).toHaveBeenCalled();
  });

  it('should call stop', async () => {
    let stopFn: (() => Promise<void>) | null = null;

    const TestComponent = () => {
      const { stop } = useSyncStatus(mockSyncEngine);
      stopFn = stop;
      return null;
    };

    render(<TestComponent />);

    await act(async () => {
      await stopFn!();
    });

    expect(mockSyncEngine.stop).toHaveBeenCalled();
  });

  it('should handle null sync engine', () => {
    const TestComponent = () => {
      const { status, isSyncing, forceSync } = useSyncStatus(null);
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="syncing">{String(isSyncing)}</span>
          <button data-testid="sync" onClick={() => forceSync()}>
            Sync
          </button>
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    expect(screen.getByTestId('syncing')).toHaveTextContent('false');

    // Should not throw when clicking sync with null engine
    act(() => {
      screen.getByTestId('sync').click();
    });
  });

  it('should handle forceSync error', async () => {
    mockSyncEngine.forceSync = vi.fn().mockRejectedValue(new Error('Sync failed'));

    let forceSyncFn: (() => Promise<void>) | null = null;

    const TestComponent = () => {
      const { forceSync, error } = useSyncStatus(mockSyncEngine);
      forceSyncFn = forceSync;
      return <span data-testid="error">{error ? error.message : 'no-error'}</span>;
    };

    render(<TestComponent />);

    await act(async () => {
      try {
        await forceSyncFn!();
      } catch {
        // Expected
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Sync failed');
    });
  });

  it('should handle start error', async () => {
    mockSyncEngine.start = vi.fn().mockRejectedValue(new Error('Start failed'));

    const TestComponent = () => {
      const { status, error } = useSyncStatus(mockSyncEngine);
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="error">{error ? error.message : 'no-error'}</span>
        </div>
      );
    };

    render(<TestComponent />);

    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Start failed');
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
  });
});

describe('useOnlineStatus', () => {
  let originalNavigator: Navigator;
  let originalWindow: Window & typeof globalThis;

  beforeEach(() => {
    originalNavigator = global.navigator;
    originalWindow = global.window;

    // Mock navigator.onLine
    Object.defineProperty(global, 'navigator', {
      value: { onLine: true },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
    });
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
    });
  });

  it('should return initial online status', () => {
    const TestComponent = () => {
      const isOnline = useOnlineStatus();
      return <span data-testid="online">{String(isOnline)}</span>;
    };

    render(<TestComponent />);

    expect(screen.getByTestId('online')).toHaveTextContent('true');
  });

  it('should update when going offline', async () => {
    const TestComponent = () => {
      const isOnline = useOnlineStatus();
      return <span data-testid="online">{String(isOnline)}</span>;
    };

    render(<TestComponent />);

    expect(screen.getByTestId('online')).toHaveTextContent('true');

    // Simulate going offline
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('online')).toHaveTextContent('false');
    });
  });

  it('should update when coming online', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { onLine: false },
      writable: true,
    });

    const TestComponent = () => {
      const isOnline = useOnlineStatus();
      return <span data-testid="online">{String(isOnline)}</span>;
    };

    render(<TestComponent />);

    expect(screen.getByTestId('online')).toHaveTextContent('false');

    // Simulate coming online
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('online')).toHaveTextContent('true');
    });
  });
});
