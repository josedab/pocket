import { afterEach, describe, expect, it, vi } from 'vitest';
import { createZodGenerator } from '../generators/zod-generator.js';
import { createWatchMode } from '../watch-mode.js';

import type { FSWatcher } from 'node:fs';
import type { SchemaDefinition } from '../generators/zod-generator.js';
import type { WatchEvent, WatchFs } from '../watch-mode.js';

// ─── Zod Generator Tests ─────────────────────────────────────────────────────

describe('createZodGenerator', () => {
  const generator = createZodGenerator();

  const schema: SchemaDefinition = {
    collections: [
      {
        name: 'users',
        fields: [
          { name: 'email', type: 'string', required: true },
          { name: 'age', type: 'number' },
          { name: 'active', type: 'boolean', default: true },
        ],
      },
      {
        name: 'posts',
        fields: [
          { name: 'title', type: 'string', required: true },
          { name: 'body', type: 'string', required: true },
          { name: 'published', type: 'boolean', default: false },
        ],
      },
    ],
  };

  describe('generate', () => {
    it('should produce valid TypeScript code importing from zod', () => {
      const output = generator.generate(schema);

      expect(output).toContain("import { z } from 'zod'");
      expect(output).toContain('z.object(');
    });

    it('should generate schemas for all collections', () => {
      const output = generator.generate(schema);

      expect(output).toContain('export const usersSchema');
      expect(output).toContain('export const postsSchema');
      expect(output).toContain('export type Users = z.infer<typeof usersSchema>');
      expect(output).toContain('export type Posts = z.infer<typeof postsSchema>');
    });

    it('should mark required fields without .optional()', () => {
      const output = generator.generate(schema);

      expect(output).toContain('email: z.string(),');
      expect(output).not.toMatch(/email: z\.string\(\)\.optional\(\)/);
    });

    it('should mark non-required fields as .optional()', () => {
      const output = generator.generate(schema);

      expect(output).toContain('age: z.number().optional()');
    });

    it('should apply defaults', () => {
      const output = generator.generate(schema);

      expect(output).toContain('.default(true)');
      expect(output).toContain('.default(false)');
    });

    it('should include auto-generated header', () => {
      const output = generator.generate(schema);

      expect(output).toContain('DO NOT EDIT');
      expect(output).toContain('@pocket/codegen');
    });
  });

  describe('generateCollection', () => {
    it('should generate a single collection schema', () => {
      const output = generator.generateCollection('tasks', [
        { name: 'title', type: 'string', required: true },
        { name: 'done', type: 'boolean', default: false },
      ]);

      expect(output).toContain("import { z } from 'zod'");
      expect(output).toContain('export const tasksSchema');
      expect(output).toContain('export type Tasks = z.infer<typeof tasksSchema>');
      expect(output).toContain('title: z.string(),');
      expect(output).toContain('done: z.boolean().optional().default(false)');
    });

    it('should handle all supported field types', () => {
      const output = generator.generateCollection('mixed', [
        { name: 'str', type: 'string', required: true },
        { name: 'num', type: 'number', required: true },
        { name: 'bool', type: 'boolean', required: true },
        { name: 'dt', type: 'date', required: true },
        { name: 'arr', type: 'array', required: true },
        { name: 'obj', type: 'object', required: true },
        { name: 'other', type: 'custom', required: true },
      ]);

      expect(output).toContain('z.string()');
      expect(output).toContain('z.number()');
      expect(output).toContain('z.boolean()');
      expect(output).toContain('z.coerce.date()');
      expect(output).toContain('z.array(z.unknown())');
      expect(output).toContain('z.record(z.string(), z.unknown())');
      expect(output).toContain('z.unknown()');
    });
  });
});

// ─── Watch Mode Tests ─────────────────────────────────────────────────────────

/** Create a mock WatchFs that captures the callback for testing. */
function createMockFs(options: { existsSync?: boolean } = {}): {
  fs: WatchFs;
  getCallback: () => ((eventType: string, filename: string | null) => void) | undefined;
  watchCallCount: () => number;
} {
  let callback: ((eventType: string, filename: string | null) => void) | undefined;
  let callCount = 0;

  const mockFs: WatchFs = {
    watch: vi.fn((_dir: unknown, _opts: unknown, cb: unknown) => {
      callCount++;
      callback = cb as typeof callback;
      return { close: vi.fn() } as unknown as FSWatcher;
    }) as unknown as WatchFs['watch'],
    existsSync: vi.fn(() => options.existsSync ?? true) as unknown as WatchFs['existsSync'],
  };

  return {
    fs: mockFs,
    getCallback: () => callback,
    watchCallCount: () => callCount,
  };
}

describe('createWatchMode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a watcher with correct initial state', () => {
    const watcher = createWatchMode({
      schemaGlob: 'schemas/*.json',
      outputDir: './out',
      generators: ['types'],
    });

    expect(watcher.isRunning).toBe(false);
    expect(watcher.onChange$).toBeDefined();
    expect(typeof watcher.start).toBe('function');
    expect(typeof watcher.stop).toBe('function');
  });

  it('should set isRunning to true after start', () => {
    const mock = createMockFs();

    const watcher = createWatchMode({
      schemaGlob: 'schemas/*.json',
      outputDir: './out',
      generators: ['types'],
      fs: mock.fs,
    });

    watcher.start();
    expect(watcher.isRunning).toBe(true);

    watcher.stop();
    expect(watcher.isRunning).toBe(false);
  });

  it('should not start twice if already running', () => {
    const mock = createMockFs();

    const watcher = createWatchMode({
      schemaGlob: 'schemas/*.json',
      outputDir: './out',
      generators: ['types'],
      fs: mock.fs,
    });

    watcher.start();
    watcher.start();

    expect(mock.watchCallCount()).toBe(1);

    watcher.stop();
  });

  it('should emit events through onChange$', async () => {
    const mock = createMockFs({ existsSync: true });

    const watcher = createWatchMode({
      schemaGlob: 'schemas/*.json',
      outputDir: './out',
      generators: ['types', 'validation'],
      debounceMs: 10,
      fs: mock.fs,
    });

    const events: WatchEvent[] = [];
    watcher.onChange$.subscribe((event) => events.push(event));

    watcher.start();

    // Simulate a file change
    mock.getCallback()?.('change', 'users.json');

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('change');
    expect(events[0]!.path).toContain('users.json');
    expect(events[0]!.generatedFiles).toHaveLength(2);
    expect(events[0]!.timestamp).toBeGreaterThan(0);

    watcher.stop();
  });

  it('should handle rename events as add when file exists', async () => {
    const mock = createMockFs({ existsSync: true });

    const watcher = createWatchMode({
      schemaGlob: 'schemas/*.json',
      outputDir: './out',
      generators: ['types'],
      debounceMs: 10,
      fs: mock.fs,
    });

    const events: WatchEvent[] = [];
    watcher.onChange$.subscribe((event) => events.push(event));

    watcher.start();
    mock.getCallback()?.('rename', 'new-schema.json');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events[0]!.type).toBe('add');

    watcher.stop();
  });

  it('should handle rename events as delete when file does not exist', async () => {
    const mock = createMockFs({ existsSync: false });

    const watcher = createWatchMode({
      schemaGlob: 'schemas/*.json',
      outputDir: './out',
      generators: ['types'],
      debounceMs: 10,
      fs: mock.fs,
    });

    const events: WatchEvent[] = [];
    watcher.onChange$.subscribe((event) => events.push(event));

    watcher.start();
    mock.getCallback()?.('rename', 'removed.json');

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events[0]!.type).toBe('delete');

    watcher.stop();
  });
});
