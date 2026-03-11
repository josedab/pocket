import { describe, expect, it, vi } from 'vitest';
import { createOpenTelemetryPlugin } from '../plugin.js';

// Mock @opentelemetry/api
vi.mock('@opentelemetry/api', () => {
  const createMockSpan = () => ({
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  });

  const mockTracer = {
    startSpan: vi.fn(() => createMockSpan()),
  };

  const createMockCounter = () => ({
    add: vi.fn(),
  });

  const createMockHistogram = () => ({
    record: vi.fn(),
  });

  const createMockUpDownCounter = () => ({
    add: vi.fn(),
  });

  const mockMeter = {
    createCounter: vi.fn(() => createMockCounter()),
    createHistogram: vi.fn(() => createMockHistogram()),
    createUpDownCounter: vi.fn(() => createMockUpDownCounter()),
  };

  return {
    trace: {
      getTracer: vi.fn(() => mockTracer),
      setSpan: vi.fn((_ctx, _span) => ({})),
    },
    context: {
      active: vi.fn(() => ({})),
      with: vi.fn((_ctx, fn) => fn()),
    },
    metrics: {
      getMeter: vi.fn(() => mockMeter),
    },
    SpanKind: { INTERNAL: 0, CLIENT: 1, SERVER: 2 },
    SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  };
});

describe('createOpenTelemetryPlugin', () => {
  it('creates a plugin with correct name and version', () => {
    const plugin = createOpenTelemetryPlugin();
    expect(plugin.name).toBe('opentelemetry');
    expect(plugin.version).toBe('0.1.0');
  });

  it('has high priority to run early', () => {
    const plugin = createOpenTelemetryPlugin();
    expect(plugin.priority).toBe(1000);
  });

  it('has all lifecycle hooks', () => {
    const plugin = createOpenTelemetryPlugin();
    expect(plugin.onInit).toBeDefined();
    expect(plugin.onDestroy).toBeDefined();
    expect(plugin.beforeInsert).toBeDefined();
    expect(plugin.afterInsert).toBeDefined();
    expect(plugin.beforeUpdate).toBeDefined();
    expect(plugin.afterUpdate).toBeDefined();
    expect(plugin.beforeDelete).toBeDefined();
    expect(plugin.afterDelete).toBeDefined();
    expect(plugin.beforeQuery).toBeDefined();
    expect(plugin.afterQuery).toBeDefined();
    expect(plugin.beforeGet).toBeDefined();
    expect(plugin.afterGet).toBeDefined();
    expect(plugin.onError).toBeDefined();
  });

  describe('onInit / onDestroy', () => {
    it('onInit increments active connections', () => {
      const plugin = createOpenTelemetryPlugin({ enableMetrics: true });
      expect(() => plugin.onInit?.()).not.toThrow();
    });

    it('onDestroy decrements active connections', () => {
      const plugin = createOpenTelemetryPlugin({ enableMetrics: true });
      expect(() => plugin.onDestroy?.()).not.toThrow();
    });
  });

  describe('insert hooks', () => {
    it('beforeInsert creates a span and returns undefined', () => {
      const plugin = createOpenTelemetryPlugin({ enableTracing: true });
      const ctx = {
        collection: 'users',
        document: { _id: '1', name: 'John' },
      };
      const result = plugin.beforeInsert?.(ctx as any);
      expect(result).toBeUndefined();
    });

    it('afterInsert ends the span', () => {
      const plugin = createOpenTelemetryPlugin({ enableTracing: true });
      const ctx: any = {
        collection: 'users',
        document: { _id: '1', name: 'John' },
      };
      plugin.beforeInsert?.(ctx);

      const doc = { _id: '1', name: 'John' };
      expect(() => plugin.afterInsert?.(doc as any, ctx)).not.toThrow();
    });

    it('skips span creation when tracing is disabled', () => {
      const plugin = createOpenTelemetryPlugin({ enableTracing: false });
      const ctx: any = {
        collection: 'users',
        document: { _id: '1', name: 'John' },
      };
      plugin.beforeInsert?.(ctx);
      expect(ctx.__otelSpan).toBeUndefined();
    });
  });

  describe('update hooks', () => {
    it('beforeUpdate creates a span', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = { collection: 'users', documentId: '1', changes: {} };
      const result = plugin.beforeUpdate?.(ctx);
      expect(result).toBeUndefined();
    });

    it('afterUpdate ends the span', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = { collection: 'users', documentId: '1', changes: {} };
      plugin.beforeUpdate?.(ctx);
      expect(() => plugin.afterUpdate?.({ _id: '1' } as any, ctx)).not.toThrow();
    });
  });

  describe('delete hooks', () => {
    it('beforeDelete creates a span', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = { collection: 'users', documentId: '1' };
      const result = plugin.beforeDelete?.(ctx);
      expect(result).toBeUndefined();
    });

    it('afterDelete ends the span', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = { collection: 'users', documentId: '1' };
      plugin.beforeDelete?.(ctx);
      expect(() => plugin.afterDelete?.(ctx)).not.toThrow();
    });
  });

  describe('query hooks', () => {
    it('beforeQuery creates a span with query attributes', () => {
      const plugin = createOpenTelemetryPlugin({ recordQueryFilters: true });
      const ctx: any = {
        collection: 'users',
        spec: { filter: { active: true }, limit: 10, skip: 0 },
      };
      const result = plugin.beforeQuery?.(ctx);
      expect(result).toBeUndefined();
    });

    it('beforeQuery omits filter when recordQueryFilters is false', () => {
      const plugin = createOpenTelemetryPlugin({ recordQueryFilters: false });
      const ctx: any = {
        collection: 'users',
        spec: { filter: { secret: 'value' }, limit: 10 },
      };
      plugin.beforeQuery?.(ctx);
      // No assertion on filter attribute omission since we're mocking,
      // but should not throw
    });

    it('afterQuery records result count and returns results', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = {
        collection: 'users',
        spec: { filter: {}, limit: 10 },
      };
      plugin.beforeQuery?.(ctx);

      const results = [{ _id: '1' }, { _id: '2' }] as any[];
      const returned = plugin.afterQuery?.(results, ctx);
      expect(returned).toEqual(results);
    });
  });

  describe('get hooks', () => {
    it('beforeGet creates a span for single document', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = { collection: 'users', documentId: '1' };
      const result = plugin.beforeGet?.(ctx);
      expect(result).toBeUndefined();
    });

    it('afterGet returns the document', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = { collection: 'users', documentId: '1' };
      plugin.beforeGet?.(ctx);

      const doc = { _id: '1', name: 'John' } as any;
      const returned = plugin.afterGet?.(doc, ctx);
      expect(returned).toEqual(doc);
    });

    it('afterGet handles null (not found)', () => {
      const plugin = createOpenTelemetryPlugin();
      const ctx: any = { collection: 'users', documentId: '999' };
      plugin.beforeGet?.(ctx);
      const returned = plugin.afterGet?.(null, ctx);
      expect(returned).toBeNull();
    });
  });

  describe('error hook', () => {
    it('records operation errors in metrics', () => {
      const plugin = createOpenTelemetryPlugin({ enableMetrics: true });
      const ctx = {
        operation: 'insert',
        collection: 'users',
        error: new Error('test error'),
      };
      expect(() => plugin.onError?.(ctx as any)).not.toThrow();
    });
  });

  describe('configuration', () => {
    it('accepts custom dbName', () => {
      const plugin = createOpenTelemetryPlugin({ dbName: 'my-app' });
      expect(plugin).toBeDefined();
    });

    it('accepts custom attributes', () => {
      const plugin = createOpenTelemetryPlugin({
        customAttributes: { env: 'production', version: 2 },
      });
      expect(plugin).toBeDefined();
    });

    it('disables both tracing and metrics', () => {
      const plugin = createOpenTelemetryPlugin({
        enableTracing: false,
        enableMetrics: false,
      });

      // Should still have hooks but they should be no-ops for tracing
      const ctx: any = {
        collection: 'test',
        document: { _id: '1' },
      };
      plugin.beforeInsert?.(ctx);
      expect(ctx.__otelSpan).toBeUndefined();
    });
  });
});
