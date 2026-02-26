/**
 * Browser-environment tests for shareable URL encoding/decoding.
 *
 * Tests btoa/atob-based URL encoding in a simulated browser environment.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  decodePlaygroundState,
  encodePlaygroundState,
  generateShareableUrl,
  parseShareableUrl,
} from '../index.js';
import type { PlaygroundState } from '../shareable-url.js';

describe('Shareable URL (browser environment)', () => {
  it('should encode state with btoa', () => {
    const state: PlaygroundState = {
      code: 'console.log("hello world")',
      language: 'typescript',
      autoRun: true,
      theme: 'dark',
      title: 'My Example',
    };

    const encoded = encodePlaygroundState(state);
    expect(encoded).toBeTruthy();
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('should decode state with atob', () => {
    const original: PlaygroundState = {
      code: 'const db = createDatabase({ name: "test" })',
      language: 'typescript',
      autoRun: false,
      theme: 'light',
      title: 'DB Setup',
    };

    const encoded = encodePlaygroundState(original);
    const decoded = decodePlaygroundState(encoded);

    expect(decoded.valid).toBe(true);
    expect(decoded.code).toBe(original.code);
    expect(decoded.language).toBe('typescript');
    expect(decoded.autoRun).toBe(false);
    expect(decoded.theme).toBe('light');
    expect(decoded.title).toBe('DB Setup');
  });

  it('should handle special characters in code', () => {
    const state: PlaygroundState = {
      code: 'const q = db.find({ "name": "O\'Brien", age: { $gt: 25 } })',
    };

    const encoded = encodePlaygroundState(state);
    const decoded = decodePlaygroundState(encoded);

    expect(decoded.valid).toBe(true);
    expect(decoded.code).toBe(state.code);
  });

  it('should handle Unicode in code', () => {
    const state: PlaygroundState = {
      code: '// 日本語コメント\nconst greeting = "こんにちは"',
    };

    const encoded = encodePlaygroundState(state);
    const decoded = decodePlaygroundState(encoded);

    expect(decoded.valid).toBe(true);
    expect(decoded.code).toContain('日本語');
  });

  it('should handle multiline code', () => {
    const state: PlaygroundState = {
      code: `const db = createDatabase({
  name: 'my-app',
  storage: createIndexedDBStorage(),
});

const todos = db.collection('todos');
await todos.insert({ title: 'Buy milk' });`,
    };

    const encoded = encodePlaygroundState(state);
    const decoded = decodePlaygroundState(encoded);

    expect(decoded.valid).toBe(true);
    expect(decoded.code).toBe(state.code);
  });

  it('should generate and parse full URLs', () => {
    const state: PlaygroundState = {
      code: 'console.log(42)',
      autoRun: true,
    };

    const url = generateShareableUrl('https://play.pocket-db.dev', state);
    expect(url.startsWith('https://play.pocket-db.dev#')).toBe(true);

    const parsed = parseShareableUrl(url);
    expect(parsed.valid).toBe(true);
    expect(parsed.code).toBe('console.log(42)');
    expect(parsed.autoRun).toBe(true);
  });

  it('should handle empty code gracefully', () => {
    const state: PlaygroundState = { code: '' };
    const encoded = encodePlaygroundState(state);
    const decoded = decodePlaygroundState(encoded);
    expect(decoded.valid).toBe(true);
    expect(decoded.code).toBe('');
  });

  it('should reject corrupted base64', () => {
    const decoded = decodePlaygroundState('!!!not-base64!!!');
    expect(decoded.valid).toBe(false);
    expect(decoded.error).toBeDefined();
  });

  it('should reject URLs without hash', () => {
    const parsed = parseShareableUrl('https://example.com/playground');
    expect(parsed.valid).toBe(false);
  });

  it('should handle very long code strings', () => {
    const longCode = 'x'.repeat(10000);
    const state: PlaygroundState = { code: longCode };

    const encoded = encodePlaygroundState(state);
    const decoded = decodePlaygroundState(encoded);

    expect(decoded.valid).toBe(true);
    expect(decoded.code).toBe(longCode);
  });
});
