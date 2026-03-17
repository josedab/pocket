/**
 * Tests for wasm-bindings module.
 *
 * Since actual Wasm binary loading requires fetch/WebAssembly in browser,
 * we test the utility functions and error paths.
 */
import { describe, expect, it } from 'vitest';
import { isWasmSupported } from '../wasm-bindings.js';

describe('isWasmSupported', () => {
  it('returns a boolean', () => {
    const result = isWasmSupported();
    expect(typeof result).toBe('boolean');
  });

  it('returns true in Node 18+ (WebAssembly is available)', () => {
    // Node 18+ has WebAssembly support
    expect(isWasmSupported()).toBe(true);
  });
});
