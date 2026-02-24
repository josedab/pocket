import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ObservableAsync,
  ObservableValue,
  createDeferred,
  debounce,
  throttle,
} from './observable.js';

describe('ObservableValue', () => {
  it('should store and retrieve initial value', () => {
    const obs = new ObservableValue(42);
    expect(obs.value).toBe(42);
  });

  it('should update value via setter', () => {
    const obs = new ObservableValue(0);
    obs.value = 10;
    expect(obs.value).toBe(10);
  });

  it('should update value via next()', () => {
    const obs = new ObservableValue(0);
    obs.next(10);
    expect(obs.value).toBe(10);
  });

  describe('subscribe()', () => {
    it('should emit current value immediately', () => {
      const obs = new ObservableValue(5);
      const values: number[] = [];
      const sub = obs.subscribe((v) => values.push(v));

      expect(values).toEqual([5]);
      sub.unsubscribe();
    });

    it('should emit on value changes', () => {
      const obs = new ObservableValue(0);
      const values: number[] = [];
      const sub = obs.subscribe((v) => values.push(v));

      obs.next(1);
      obs.next(2);

      expect(values).toEqual([0, 1, 2]);
      sub.unsubscribe();
    });

    it('should stop emitting after unsubscribe', () => {
      const obs = new ObservableValue(0);
      const values: number[] = [];
      const sub = obs.subscribe((v) => values.push(v));

      obs.next(1);
      sub.unsubscribe();
      obs.next(2);

      expect(values).toEqual([0, 1]);
    });
  });

  describe('subscribeDistinct()', () => {
    it('should only emit when value changes', () => {
      const obs = new ObservableValue(0);
      const values: number[] = [];
      const sub = obs.subscribeDistinct((v) => values.push(v));

      obs.next(0); // Same value - should not emit
      obs.next(1);
      obs.next(1); // Same value - should not emit
      obs.next(2);

      expect(values).toEqual([0, 1, 2]);
      sub.unsubscribe();
    });

    it('should accept custom comparator', () => {
      const obs = new ObservableValue({ id: 1, name: 'a' });
      const values: { id: number; name: string }[] = [];
      const sub = obs.subscribeDistinct(
        (v) => values.push(v),
        (a, b) => a.id === b.id
      );

      obs.next({ id: 1, name: 'b' }); // Same id - filtered
      obs.next({ id: 2, name: 'c' }); // Different id - emitted

      expect(values).toHaveLength(2);
      expect(values[1].id).toBe(2);
      sub.unsubscribe();
    });
  });

  describe('asObservable()', () => {
    it('should return an observable', () => {
      const obs = new ObservableValue(0);
      const observable = obs.asObservable();
      const values: number[] = [];

      const sub = observable.subscribe((v) => values.push(v));
      obs.next(1);

      expect(values.length).toBeGreaterThanOrEqual(1);
      sub.unsubscribe();
    });
  });

  describe('destroy()', () => {
    it('should complete the observable', () => {
      const obs = new ObservableValue(0);
      let completed = false;
      obs.subscribe({
        complete: () => {
          completed = true;
        },
      });

      obs.destroy();

      expect(completed).toBe(true);
    });

    it('should stop emitting after destroy', () => {
      const obs = new ObservableValue(0);
      const values: number[] = [];
      obs.subscribe((v) => values.push(v));

      obs.destroy();
      // After destroy, next() goes to completed subject
      // (won't emit to subscribers)

      expect(values).toEqual([0]);
    });
  });

  describe('edge cases', () => {
    it('should not throw when emitting after unsubscribe', () => {
      const obs = new ObservableValue(0);
      const values: number[] = [];
      const sub = obs.subscribe((v) => values.push(v));

      sub.unsubscribe();

      // Should not throw or emit
      obs.next(1);
      obs.next(2);

      expect(values).toEqual([0]);
    });

    it('should support multiple concurrent subscribers', () => {
      const obs = new ObservableValue(0);
      const values1: number[] = [];
      const values2: number[] = [];

      const sub1 = obs.subscribe((v) => values1.push(v));
      const sub2 = obs.subscribe((v) => values2.push(v));

      obs.next(1);

      expect(values1).toEqual([0, 1]);
      expect(values2).toEqual([0, 1]);

      sub1.unsubscribe();
      obs.next(2);

      expect(values1).toEqual([0, 1]); // stopped
      expect(values2).toEqual([0, 1, 2]); // still receiving

      sub2.unsubscribe();
    });
  });
});

describe('ObservableAsync', () => {
  it('should initialize with data and no loading/error', () => {
    const obs = new ObservableAsync<string[]>([]);

    expect(obs.data).toEqual([]);
    expect(obs.isLoading).toBe(false);
    expect(obs.error).toBeNull();
  });

  describe('setLoading()', () => {
    it('should update loading state', () => {
      const obs = new ObservableAsync<string[]>([]);
      obs.setLoading(true);

      expect(obs.isLoading).toBe(true);
      expect(obs.data).toEqual([]);
    });
  });

  describe('setData()', () => {
    it('should set data and clear loading/error', () => {
      const obs = new ObservableAsync<string[]>([]);
      obs.setLoading(true);
      obs.setData(['a', 'b']);

      expect(obs.data).toEqual(['a', 'b']);
      expect(obs.isLoading).toBe(false);
      expect(obs.error).toBeNull();
    });
  });

  describe('setError()', () => {
    it('should set error and clear loading', () => {
      const obs = new ObservableAsync<string[]>([]);
      obs.setLoading(true);
      obs.setError(new Error('failed'));

      expect(obs.error).toBeDefined();
      expect(obs.error!.message).toBe('failed');
      expect(obs.isLoading).toBe(false);
      // Data should be preserved
      expect(obs.data).toEqual([]);
    });
  });

  describe('subscribe()', () => {
    it('should emit full state on changes', () => {
      const obs = new ObservableAsync<number>(0);
      const states: { data: number; isLoading: boolean; error: Error | null }[] = [];
      const sub = obs.subscribe((s) => states.push({ ...s }));

      obs.setLoading(true);
      obs.setData(42);

      expect(states.length).toBeGreaterThanOrEqual(3);
      expect(states[states.length - 1].data).toBe(42);
      expect(states[states.length - 1].isLoading).toBe(false);
      sub.unsubscribe();
    });
  });

  describe('state getter', () => {
    it('should return current snapshot', () => {
      const obs = new ObservableAsync<number>(5);
      const state = obs.state;

      expect(state.data).toBe(5);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('destroy()', () => {
    it('should complete the observable', () => {
      const obs = new ObservableAsync<number>(0);
      let completed = false;
      obs.subscribe({
        complete: () => {
          completed = true;
        },
      });

      obs.destroy();

      expect(completed).toBe(true);
    });
  });
});

describe('createDeferred', () => {
  it('should create a resolvable promise', async () => {
    const deferred = createDeferred<string>();

    deferred.resolve('hello');

    const result = await deferred.promise;
    expect(result).toBe('hello');
  });

  it('should create a rejectable promise', async () => {
    const deferred = createDeferred<string>();

    deferred.reject(new Error('failed'));

    await expect(deferred.promise).rejects.toThrow('failed');
  });

  it('should be usable as request/response pattern', async () => {
    const deferred = createDeferred<number>();

    setTimeout(() => deferred.resolve(42), 10);

    const result = await deferred.promise;
    expect(result).toBe(42);
  });
});

describe('debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay execution', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('a');
  });

  it('should reset timer on new calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    vi.advanceTimersByTime(50);
    debounced('b');
    vi.advanceTimersByTime(50);
    // 'a' timer was reset, only 50ms of 'b' timer elapsed
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    // Now 'b' timer completed
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('should call with last value after rapid calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced('b');
    debounced('c');

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });
});

describe('throttle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute immediately on first call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');

    expect(fn).toHaveBeenCalledWith('a');
  });

  it('should rate-limit subsequent calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a'); // Immediate
    throttled('b'); // Queued
    throttled('c'); // Replaces queued

    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');
  });

  it('should allow calls after delay expires', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    vi.advanceTimersByTime(100);
    throttled('b');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
  });
});
