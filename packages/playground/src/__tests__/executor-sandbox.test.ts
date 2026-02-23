import { describe, it, expect } from 'vitest';
import { createCodeExecutor } from '../executor.js';

describe('CodeExecutor sandbox', () => {
  const executor = createCodeExecutor({ timeoutMs: 2000 });

  it('should execute simple expressions', async () => {
    const result = await executor.execute('return 2 + 2');
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(4);
  });

  it('should capture console.log output', async () => {
    const result = await executor.execute('console.log("hello")');
    expect(result.success).toBe(true);
    expect(result.output.some((o) => o.content === 'hello')).toBe(true);
  });

  it('should block process access', async () => {
    const result = await executor.execute('return process.env');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked');
    expect(result.error).toContain('process');
  });

  it('should block require calls', async () => {
    const result = await executor.execute("const fs = require('fs')");
    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked');
  });

  it('should block eval usage', async () => {
    const result = await executor.execute('return eval("1+1")');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked');
  });

  it('should block Function constructor access', async () => {
    const result = await executor.execute('return Function("return 1")()');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked');
  });

  it('should block globalThis access', async () => {
    const result = await executor.execute('return globalThis');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked');
  });

  it('should allow safe code with context', async () => {
    const result = await executor.execute('return x + y', { x: 10, y: 20 });
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(30);
  });

  it('should report execution time', async () => {
    const result = await executor.execute('return 42');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle syntax errors gracefully', async () => {
    const result = await executor.execute('return {{{');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should validate syntax', () => {
    const valid = executor.validateSyntax('return 1 + 1');
    expect(valid.valid).toBe(true);

    const invalid = executor.validateSyntax('function x( {');
    expect(invalid.valid).toBe(false);
  });
});
