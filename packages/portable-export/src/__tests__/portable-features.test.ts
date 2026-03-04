import { describe, expect, it, vi } from 'vitest';
import {
  CsvAdapter,
  JsonAdapter,
  NdjsonAdapter,
  SqlAdapter,
  getFormatAdapter,
} from '../format-adapters.js';
import { PortableAPI } from '../portable-api.js';
import { StreamingPipeline } from '../streaming-pipeline.js';

// ─── Format Adapters ────────────────────────────────────────────────

describe('JsonAdapter', () => {
  const adapter = new JsonAdapter();

  it('should serialize and deserialize roundtrip', () => {
    const docs = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];
    const serialized = adapter.serialize(docs);
    const result = adapter.deserialize(serialized);
    expect(result).toEqual(docs);
  });

  it('should serialize with pretty option', () => {
    const docs = [{ a: 1 }];
    const pretty = adapter.serialize(docs, { pretty: true });
    expect(pretty).toContain('\n');
    expect(pretty).toContain('  ');
  });

  it('should deserialize a single object as array', () => {
    const result = adapter.deserialize('{"id": 1}');
    expect(result).toEqual([{ id: 1 }]);
  });

  it('should throw on invalid JSON input', () => {
    expect(() => adapter.deserialize('"just a string"')).toThrow('Invalid JSON');
  });
});

describe('CsvAdapter', () => {
  const adapter = new CsvAdapter();

  it('should serialize and deserialize roundtrip', () => {
    const docs = [
      { id: 1, name: 'Alice', active: true },
      { id: 2, name: 'Bob', active: false },
    ];
    const csv = adapter.serialize(docs);
    const result = adapter.deserialize(csv);
    expect(result).toEqual(docs);
  });

  it('should handle fields with commas and quotes', () => {
    const docs = [{ name: 'O"Brien', city: 'New York, NY' }];
    const csv = adapter.serialize(docs);
    expect(csv).toContain('"');
    const result = adapter.deserialize(csv);
    expect(result[0].name).toBe('O"Brien');
    expect(result[0].city).toBe('New York, NY');
  });

  it('should use custom delimiter', () => {
    const docs = [{ a: 1, b: 2 }];
    const tsv = adapter.serialize(docs, { delimiter: '\t' });
    expect(tsv).toContain('\t');
    const result = adapter.deserialize(tsv, { delimiter: '\t' });
    expect(result[0].a).toBe(1);
    expect(result[0].b).toBe(2);
  });

  it('should omit headers when includeHeaders is false', () => {
    const docs = [{ a: 1 }];
    const csv = adapter.serialize(docs, { includeHeaders: false });
    expect(csv).toBe('1');
  });

  it('should return empty array for empty data', () => {
    expect(adapter.deserialize('')).toEqual([]);
  });

  it('should use custom null value', () => {
    const docs = [{ a: null, b: 'ok' }];
    const csv = adapter.serialize(docs, { nullValue: 'N/A' });
    expect(csv).toContain('N/A');
  });
});

describe('SqlAdapter', () => {
  const adapter = new SqlAdapter();

  it('should generate CREATE TABLE and INSERT statements', () => {
    const docs = [{ id: 1, name: 'Alice' }];
    const sql = adapter.serialize(docs, { tableName: 'users' });
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(sql).toContain('INSERT INTO "users"');
    expect(sql).toContain("'Alice'");
  });

  it('should serialize and deserialize roundtrip', () => {
    const docs = [
      { id: 1, name: 'Alice' },
      { id: 2, name: "O'Brien" },
    ];
    const sql = adapter.serialize(docs, { tableName: 'users' });
    const result = adapter.deserialize(sql);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('Alice');
    expect(result[1].name).toBe("O'Brien");
  });

  it('should handle NULL values', () => {
    const docs = [{ id: 1, name: null }];
    const sql = adapter.serialize(docs);
    expect(sql).toContain('NULL');
    const result = adapter.deserialize(sql);
    expect(result[0].name).toBeNull();
  });

  it('should use default table name', () => {
    const docs = [{ a: 1 }];
    const sql = adapter.serialize(docs);
    expect(sql).toContain('"data"');
  });
});

describe('NdjsonAdapter', () => {
  const adapter = new NdjsonAdapter();

  it('should serialize and deserialize roundtrip', () => {
    const docs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const ndjson = adapter.serialize(docs);
    expect(ndjson.split('\n').length).toBe(3);
    const result = adapter.deserialize(ndjson);
    expect(result).toEqual(docs);
  });

  it('should skip empty lines on deserialize', () => {
    const data = '{"id":1}\n\n{"id":2}\n';
    const result = adapter.deserialize(data);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe('getFormatAdapter', () => {
  it('should return adapters for all supported formats', () => {
    expect(getFormatAdapter('json').format).toBe('json');
    expect(getFormatAdapter('csv').format).toBe('csv');
    expect(getFormatAdapter('sql').format).toBe('sql');
    expect(getFormatAdapter('ndjson').format).toBe('ndjson');
  });

  it('should throw for unsupported format', () => {
    expect(() => getFormatAdapter('xml')).toThrow('Unsupported format: xml');
  });
});

// ─── Streaming Pipeline ─────────────────────────────────────────────

describe('StreamingPipeline', () => {
  it('should export stream with progress events', async () => {
    const docs = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    const pipeline = new StreamingPipeline({ chunkSize: 100 });
    const progressEvents: unknown[] = [];

    pipeline.progress.subscribe((p) => progressEvents.push(p));

    const chunks: string[] = [];
    for await (const chunk of pipeline.exportStream(docs, (c) => JSON.stringify(c))) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(3); // 100 + 100 + 50
    expect(progressEvents.length).toBeGreaterThan(0);

    const lastProgress = progressEvents[progressEvents.length - 1] as {
      phase: string;
      processedItems: number;
    };
    expect(lastProgress.phase).toBe('complete');
    expect(lastProgress.processedItems).toBe(250);

    pipeline.destroy();
  });

  it('should abort the pipeline', async () => {
    const docs = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const pipeline = new StreamingPipeline({ chunkSize: 50 });

    const chunks: string[] = [];
    for await (const chunk of pipeline.exportStream(docs, (c) => JSON.stringify(c))) {
      chunks.push(chunk);
      if (chunks.length === 2) pipeline.abort();
    }

    expect(chunks.length).toBeLessThan(10);
    pipeline.destroy();
  });

  it('should import from async iterable', async () => {
    const pipeline = new StreamingPipeline();
    async function* source() {
      yield '[{"id":1},{"id":2}]';
      yield '[{"id":3}]';
    }
    const result = await pipeline.importStream(source(), (chunk) => JSON.parse(chunk));
    expect(result.length).toBe(3);
    pipeline.destroy();
  });

  it('should invoke onProgress callback', async () => {
    const progressFn = vi.fn();
    const pipeline = new StreamingPipeline({ chunkSize: 10, onProgress: progressFn });
    const docs = Array.from({ length: 25 }, (_, i) => ({ id: i }));

    const chunks: string[] = [];
    for await (const chunk of pipeline.exportStream(docs, (c) => JSON.stringify(c))) {
      chunks.push(chunk);
    }

    expect(progressFn).toHaveBeenCalled();
    pipeline.destroy();
  });
});

// ─── Portable API ───────────────────────────────────────────────────

describe('PortableAPI', () => {
  const api = new PortableAPI();

  it('should export and import roundtrip with JSON', () => {
    const collections = {
      users: [{ id: 1, name: 'Alice' }],
      posts: [{ id: 1, title: 'Hello' }],
    };

    const exported = api.export({ format: 'json', collections });
    expect(exported.format).toBe('json');
    expect(exported.documentCount).toBe(2);
    expect(exported.collections).toEqual(['users', 'posts']);
    expect(exported.byteSize).toBeGreaterThan(0);
    expect(exported.checksum).toBeTruthy();

    const imported = api.import({ format: 'json', data: exported.data });
    expect(imported.documentCount).toBe(2);
    expect(imported.errors.length).toBe(0);
  });

  it('should export with metadata and group on import', () => {
    const collections = {
      users: [{ id: 1, name: 'Alice' }],
      posts: [{ id: 1, title: 'Hello' }],
    };

    const exported = api.export({ format: 'json', collections, includeMetadata: true });
    const imported = api.import({ format: 'json', data: exported.data });

    expect(imported.collections).toContain('users');
    expect(imported.collections).toContain('posts');
    expect(imported.documents['users']!.length).toBe(1);
    expect(imported.documents['posts']!.length).toBe(1);
    // Metadata fields should be stripped
    expect(imported.documents['users']![0]._collection).toBeUndefined();
    expect(imported.documents['users']![0]._exportedAt).toBeUndefined();
  });

  it('should verify checksum correctly', () => {
    const data = 'test data for checksum';
    const checksum = (api as any).computeChecksum(data);
    expect(api.verifyChecksum(data, checksum)).toBe(true);
    expect(api.verifyChecksum(data, 'wrong')).toBe(false);
  });

  it('should handle import parse errors gracefully', () => {
    const result = api.import({ format: 'json', data: 'not valid json{{{' });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].collection).toBe('_parse');
  });

  it('should export SQL with per-collection tables', () => {
    const collections = {
      users: [{ id: 1, name: 'Alice' }],
      logs: [{ id: 1, event: 'login' }],
    };

    const exported = api.export({ format: 'sql', collections });
    expect(exported.data).toContain('"users"');
    expect(exported.data).toContain('"logs"');
  });

  it('should create export stream', async () => {
    const docs = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const { stream, progress$ } = api.createExportStream('ndjson', docs, { chunkSize: 20 });

    const events: unknown[] = [];
    const sub = progress$.subscribe((p) => events.push(p));

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(3); // 20 + 20 + 10
    expect(events.length).toBeGreaterThan(0);
    sub.unsubscribe();
  });

  it('should export and import NDJSON roundtrip', () => {
    const collections = { items: [{ a: 1 }, { a: 2 }] };
    const exported = api.export({ format: 'ndjson', collections });
    const imported = api.import({ format: 'ndjson', data: exported.data });
    expect(imported.documentCount).toBe(2);
  });

  it('should export and import CSV roundtrip', () => {
    const collections = {
      items: [
        { x: 1, y: 'hello' },
        { x: 2, y: 'world' },
      ],
    };
    const exported = api.export({ format: 'csv', collections });
    const imported = api.import({ format: 'csv', data: exported.data });
    expect(imported.documentCount).toBe(2);
  });
});
