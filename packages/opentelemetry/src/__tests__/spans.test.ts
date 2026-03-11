import { describe, expect, it, vi } from 'vitest';
import {
  OPERATIONS,
  SPAN_ATTRIBUTES,
  TRACER_NAME,
  addCollectionAttributes,
  addDocumentAttributes,
  addQueryAttributes,
  getTracer,
  recordError,
  startSpan,
  withSpan,
  withSpanSync,
} from '../spans.js';

// Mock @opentelemetry/api
vi.mock('@opentelemetry/api', () => {
  const mockSpan = {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };

  const mockTracer = {
    startSpan: vi.fn(() => mockSpan),
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
    SpanKind: { INTERNAL: 0, CLIENT: 1, SERVER: 2 },
    SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
    metrics: {
      getMeter: vi.fn(),
    },
  };
});

describe('spans', () => {
  describe('constants', () => {
    it('exports span attribute names', () => {
      expect(SPAN_ATTRIBUTES.DB_SYSTEM).toBe('db.system');
      expect(SPAN_ATTRIBUTES.DB_NAME).toBe('db.name');
      expect(SPAN_ATTRIBUTES.DB_OPERATION).toBe('db.operation');
      expect(SPAN_ATTRIBUTES.COLLECTION_NAME).toBe('pocket.collection.name');
      expect(SPAN_ATTRIBUTES.DOCUMENT_ID).toBe('pocket.document.id');
      expect(SPAN_ATTRIBUTES.QUERY_FILTER).toBe('pocket.query.filter');
      expect(SPAN_ATTRIBUTES.ERROR_TYPE).toBe('pocket.error.type');
    });

    it('exports operation names', () => {
      expect(OPERATIONS.INSERT).toBe('pocket.document.insert');
      expect(OPERATIONS.UPDATE).toBe('pocket.document.update');
      expect(OPERATIONS.DELETE).toBe('pocket.document.delete');
      expect(OPERATIONS.FIND).toBe('pocket.query.find');
      expect(OPERATIONS.FIND_ONE).toBe('pocket.query.findOne');
      expect(OPERATIONS.SYNC_PUSH).toBe('pocket.sync.push');
      expect(OPERATIONS.SYNC_PULL).toBe('pocket.sync.pull');
    });

    it('exports tracer name', () => {
      expect(TRACER_NAME).toBe('@pocket/opentelemetry');
    });
  });

  describe('getTracer', () => {
    it('returns a tracer with default name', () => {
      const tracer = getTracer();
      expect(tracer).toBeDefined();
      expect(tracer.startSpan).toBeDefined();
    });

    it('accepts custom name and version', () => {
      const tracer = getTracer('custom', '1.0.0');
      expect(tracer).toBeDefined();
    });
  });

  describe('startSpan', () => {
    it('starts a span with operation name', () => {
      const tracer = getTracer();
      const span = startSpan(tracer, OPERATIONS.INSERT);
      expect(span).toBeDefined();
      expect(tracer.startSpan).toHaveBeenCalledWith(
        OPERATIONS.INSERT,
        expect.objectContaining({
          attributes: expect.objectContaining({
            [SPAN_ATTRIBUTES.DB_SYSTEM]: 'pocket',
          }),
        }),
        expect.anything()
      );
    });

    it('merges custom attributes', () => {
      const tracer = getTracer();
      startSpan(tracer, OPERATIONS.INSERT, {
        attributes: { 'custom.attr': 'value' },
      });
      expect(tracer.startSpan).toHaveBeenCalledWith(
        OPERATIONS.INSERT,
        expect.objectContaining({
          attributes: expect.objectContaining({
            'custom.attr': 'value',
          }),
        }),
        expect.anything()
      );
    });
  });

  describe('withSpan', () => {
    it('executes function within a span and ends span on success', async () => {
      const tracer = getTracer();
      const result = await withSpan(tracer, 'test-op', async (span) => {
        expect(span).toBeDefined();
        return 42;
      });
      expect(result).toBe(42);
    });

    it('records error and rethrows on failure', async () => {
      const tracer = getTracer();
      const error = new Error('test error');

      await expect(
        withSpan(tracer, 'test-op', async () => {
          throw error;
        })
      ).rejects.toThrow('test error');
    });
  });

  describe('withSpanSync', () => {
    it('executes synchronous function within a span', () => {
      const tracer = getTracer();
      const result = withSpanSync(tracer, 'test-op', (span) => {
        expect(span).toBeDefined();
        return 'hello';
      });
      expect(result).toBe('hello');
    });

    it('records error and rethrows on failure', () => {
      const tracer = getTracer();
      expect(() =>
        withSpanSync(tracer, 'test-op', () => {
          throw new Error('sync error');
        })
      ).toThrow('sync error');
    });
  });

  describe('recordError', () => {
    it('records Error instances with exception and status', () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
      };

      const error = new Error('test');
      recordError(mockSpan as any, error);

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ code: 2 }) // SpanStatusCode.ERROR
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.ERROR_TYPE, 'Error');
    });

    it('handles non-Error values', () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
      };

      recordError(mockSpan as any, 'string error');
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'string error' })
      );
    });

    it('records error code if present', () => {
      const mockSpan = {
        recordException: vi.fn(),
        setStatus: vi.fn(),
        setAttribute: vi.fn(),
      };

      const error = Object.assign(new Error('coded'), { code: 'POCKET_ERR' });
      recordError(mockSpan as any, error);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.ERROR_CODE, 'POCKET_ERR');
    });
  });

  describe('addCollectionAttributes', () => {
    it('sets collection name', () => {
      const span = { setAttribute: vi.fn() };
      addCollectionAttributes(span as any, 'users');
      expect(span.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.COLLECTION_NAME, 'users');
    });

    it('sets db name when provided', () => {
      const span = { setAttribute: vi.fn() };
      addCollectionAttributes(span as any, 'users', 'my-app');
      expect(span.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.DB_NAME, 'my-app');
    });

    it('skips db name when not provided', () => {
      const span = { setAttribute: vi.fn() };
      addCollectionAttributes(span as any, 'users');
      expect(span.setAttribute).not.toHaveBeenCalledWith(
        SPAN_ATTRIBUTES.DB_NAME,
        expect.anything()
      );
    });
  });

  describe('addDocumentAttributes', () => {
    it('sets document id', () => {
      const span = { setAttribute: vi.fn() };
      addDocumentAttributes(span as any, 'doc-123');
      expect(span.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.DOCUMENT_ID, 'doc-123');
    });

    it('sets document count', () => {
      const span = { setAttribute: vi.fn() };
      addDocumentAttributes(span as any, undefined, 10);
      expect(span.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.DOCUMENT_COUNT, 10);
    });

    it('handles both id and count', () => {
      const span = { setAttribute: vi.fn() };
      addDocumentAttributes(span as any, 'doc-1', 5);
      expect(span.setAttribute).toHaveBeenCalledTimes(2);
    });

    it('skips when both undefined', () => {
      const span = { setAttribute: vi.fn() };
      addDocumentAttributes(span as any);
      expect(span.setAttribute).not.toHaveBeenCalled();
    });
  });

  describe('addQueryAttributes', () => {
    it('sets filter as JSON string', () => {
      const span = { setAttribute: vi.fn() };
      addQueryAttributes(span as any, { filter: { active: true } });
      expect(span.setAttribute).toHaveBeenCalledWith(
        SPAN_ATTRIBUTES.QUERY_FILTER,
        '{"active":true}'
      );
    });

    it('sets limit and offset', () => {
      const span = { setAttribute: vi.fn() };
      addQueryAttributes(span as any, { limit: 10, offset: 20 });
      expect(span.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.QUERY_LIMIT, 10);
      expect(span.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.QUERY_OFFSET, 20);
    });

    it('sets sort as JSON string', () => {
      const span = { setAttribute: vi.fn() };
      addQueryAttributes(span as any, { sort: { name: 'asc' } });
      expect(span.setAttribute).toHaveBeenCalledWith(SPAN_ATTRIBUTES.QUERY_SORT, '{"name":"asc"}');
    });

    it('skips undefined fields', () => {
      const span = { setAttribute: vi.fn() };
      addQueryAttributes(span as any, {});
      expect(span.setAttribute).not.toHaveBeenCalled();
    });
  });
});
