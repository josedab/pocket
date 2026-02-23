import { BehaviorSubject, Subject, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AwarenessState } from '../awareness.js';
import type { SDKStatus } from '../collaboration-sdk.js';
import { createCollabReactSDK, type CollabReactHooks, type ReactContext } from '../react-collab.js';

// ── Mock React implementation ────────────────────────────

function createMockReact(): CollabReactHooks {
  let contextValue: unknown = null;
  // Persistent state store keyed by sequential ID
  const stateStore = new Map<number, { value: unknown }>();
  let stateCounter = 0;

  return {
    useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
      const key = stateCounter++;
      if (!stateStore.has(key)) {
        stateStore.set(key, typeof initial === 'function' ? (initial as () => T)() : initial);
      }
      const setState = (v: T | ((prev: T) => T)) => {
        const current = stateStore.get(key) as T;
        stateStore.set(key, typeof v === 'function' ? (v as (prev: T) => T)(current) : v);
      };
      return [stateStore.get(key) as T, setState];
    },

    useEffect(effect: () => void | (() => void)) {
      effect();
    },

    useCallback<T extends (...args: never[]) => unknown>(fn: T): T {
      return fn;
    },

    useContext<T>(context: ReactContext<T>): T {
      return (contextValue ?? context._currentValue) as T;
    },

    useRef<T>(initial: T): { current: T } {
      return { current: initial };
    },

    useMemo<T>(factory: () => T): T {
      return factory();
    },

    createContext<T>(defaultValue: T): ReactContext<T> {
      return {
        Provider: 'MockProvider',
        _currentValue: defaultValue,
      };
    },

    createElement(type: unknown, props: unknown, ...children: unknown[]): unknown {
      const p = props as Record<string, unknown> | null;
      if (p?.value !== undefined) {
        contextValue = p.value;
      }
      return { type, props: p, children };
    },
  };
}

// ── Mock CollaborationSDK ────────────────────────────────

function createMockSDK() {
  const statusSubject = new BehaviorSubject<SDKStatus>('disconnected');
  const awarenessSubject = new BehaviorSubject<Map<string, AwarenessState>>(new Map());
  const editsSubject = new Subject<{ userId: string; collection: string; documentId: string }>();

  const sdk = {
    status$: statusSubject.asObservable() as Observable<SDKStatus>,
    awareness$: awarenessSubject.asObservable() as Observable<Map<string, AwarenessState>>,
    remoteEdits$: editsSubject.asObservable(),
    setCursor: vi.fn(),

    // Test helpers
    _setStatus: (s: SDKStatus) => statusSubject.next(s),
    _setAwareness: (states: Map<string, AwarenessState>) => awarenessSubject.next(states),
    _emitEdit: (edit: { userId: string; collection: string; documentId: string }) =>
      editsSubject.next(edit),
  };

  return sdk;
}

// ── Tests ────────────────────────────────────────────────

describe('React Collaboration SDK', () => {
  function setup() {
    const mockReact = createMockReact();
    const api = createCollabReactSDK(mockReact);
    return { mockReact, api };
  }

  describe('createCollabReactSDK', () => {
    it('should return all expected API functions', () => {
      const { api } = setup();
      expect(typeof api.CollabProvider).toBe('function');
      expect(typeof api.useCollaborators).toBe('function');
      expect(typeof api.useCursors).toBe('function');
      expect(typeof api.useCollabStatus).toBe('function');
      expect(typeof api.useRemoteEdits).toBe('function');
      expect(typeof api.useAwareness).toBe('function');
      expect(typeof api.usePresenceAvatars).toBe('function');
    });
  });

  describe('CollabProvider', () => {
    it('should render with createElement passing SDK as value', () => {
      const { api } = setup();
      const sdk = createMockSDK();
      const result = api.CollabProvider({ sdk: sdk as never, children: 'hello' }) as {
        type: unknown;
        props: Record<string, unknown>;
        children: unknown[];
      };

      expect(result).toBeDefined();
      expect(result.props?.value).toBe(sdk);
      expect(result.children).toContain('hello');
    });

    it('should set context value for hooks', () => {
      const { api } = setup();
      const sdk = createMockSDK();
      api.CollabProvider({ sdk: sdk as never, children: null });

      // useCollabStatus should now be able to read the SDK from context
      const status = api.useCollabStatus();
      expect(status).toBe('disconnected');
    });
  });

  describe('useCollabStatus', () => {
    it('should return current SDK connection status', () => {
      const { api } = setup();
      const sdk = createMockSDK();
      api.CollabProvider({ sdk: sdk as never, children: null });

      const status = api.useCollabStatus();
      expect(status).toBe('disconnected');
    });
  });

  describe('useAwareness', () => {
    it('should return states map and setLocal function', () => {
      const { api } = setup();
      const sdk = createMockSDK();
      api.CollabProvider({ sdk: sdk as never, children: null });

      const { states, setLocal } = api.useAwareness();
      expect(states).toBeDefined();
      expect(typeof setLocal).toBe('function');

      setLocal({ line: 20, column: 5 });
      expect(sdk.setCursor).toHaveBeenCalledWith({ line: 20, column: 5 });
    });
  });

  describe('useRemoteEdits', () => {
    it('should invoke callback on remote edits via subscription', () => {
      const { api } = setup();
      const sdk = createMockSDK();
      api.CollabProvider({ sdk: sdk as never, children: null });

      const edits: unknown[] = [];
      api.useRemoteEdits((edit) => edits.push(edit));

      sdk._emitEdit({ userId: 'u1', collection: 'notes', documentId: 'n1' });
      sdk._emitEdit({ userId: 'u2', collection: 'tasks', documentId: 't1' });

      expect(edits).toHaveLength(2);
      expect((edits[0] as Record<string, unknown>).userId).toBe('u1');
      expect((edits[1] as Record<string, unknown>).collection).toBe('tasks');
    });
  });
});
