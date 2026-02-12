import { describe, expect, it } from 'vitest';
import { createEmbedConfig } from '../config.js';
import {
  createCodeExecutor,
  createExampleTemplates,
  createPlaygroundConfig,
  createPlaygroundSandbox,
  getTemplateByName,
} from '../index.js';
import { getTemplatesByCategory, getTemplatesByTag } from '../templates.js';

describe('CodeExecutor', () => {
  it('should execute simple code and return result', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('return 2 + 2');
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(4);
    expect(result.error).toBeNull();
  });

  it('should capture console.log output', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('console.log("hello"); return 42');
    expect(result.success).toBe(true);
    expect(result.output.length).toBe(2);
    expect(result.output[0]!.content).toBe('hello');
    expect(result.output[0]!.type).toBe('log');
    expect(result.output[1]!.content).toBe('42');
    expect(result.output[1]!.type).toBe('result');
  });

  it('should capture console.error output', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('console.error("oops")');
    expect(result.output.length).toBe(1);
    expect(result.output[0]!.type).toBe('error');
    expect(result.output[0]!.content).toBe('oops');
  });

  it('should capture console.warn output', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('console.warn("caution")');
    expect(result.output[0]!.type).toBe('warn');
  });

  it('should capture console.info output', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('console.info("fyi")');
    expect(result.output[0]!.type).toBe('info');
  });

  it('should handle errors gracefully', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('throw new Error("boom")');
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle syntax errors', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('if (');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should timeout long-running async code', async () => {
    const executor = createCodeExecutor({ timeoutMs: 50 });
    const result = await executor.execute(
      'return new Promise(resolve => setTimeout(resolve, 10000))'
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  }, 10000);

  it('should inject context variables', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('return x + y', { x: 10, y: 20 });
    expect(result.success).toBe(true);
    expect(result.returnValue).toBe(30);
  });

  it('should limit output lines', async () => {
    const executor = createCodeExecutor({ maxOutputLines: 3 });
    const result = await executor.execute('for (let i = 0; i < 100; i++) console.log(i);');
    expect(result.output.length).toBe(3);
  });

  it('should validate correct syntax', () => {
    const executor = createCodeExecutor();
    const result = executor.validateSyntax('const x = 1;');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate incorrect syntax', () => {
    const executor = createCodeExecutor();
    const result = executor.validateSyntax('if (');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should format objects as JSON in output', async () => {
    const executor = createCodeExecutor();
    const result = await executor.execute('return { a: 1 }');
    expect(result.output[0]!.content).toContain('"a": 1');
  });

  it('should format null and undefined correctly', async () => {
    const executor = createCodeExecutor();
    const r1 = await executor.execute('console.log(null)');
    expect(r1.output[0]!.content).toBe('null');
    const r2 = await executor.execute('console.log(undefined)');
    expect(r2.output[0]!.content).toBe('undefined');
  });
});

describe('PlaygroundSandbox', () => {
  it('should create with default state', () => {
    const sandbox = createPlaygroundSandbox();
    expect(sandbox.state.code).toBe('');
    expect(sandbox.state.isRunning).toBe(false);
    expect(sandbox.state.output).toEqual([]);
    sandbox.destroy();
  });

  it('should accept initial code', () => {
    const sandbox = createPlaygroundSandbox({ initialCode: 'return 1' });
    expect(sandbox.state.code).toBe('return 1');
    expect(sandbox.getCode()).toBe('return 1');
    sandbox.destroy();
  });

  it('should run code and update state', async () => {
    const sandbox = createPlaygroundSandbox();
    await sandbox.run('console.log("hi"); return 42');
    expect(sandbox.state.output).toContain('hi');
    expect(sandbox.state.isRunning).toBe(false);
    expect(sandbox.state.error).toBeNull();
    expect(sandbox.state.executionTimeMs).toBeGreaterThanOrEqual(0);
    expect(sandbox.state.lastRunAt).toBeTruthy();
    sandbox.destroy();
  });

  it('should run current code when no argument given', async () => {
    const sandbox = createPlaygroundSandbox();
    sandbox.setCode('return 99');
    await sandbox.run();
    expect(sandbox.state.code).toBe('return 99');
    sandbox.destroy();
  });

  it('should emit state changes via observable', async () => {
    const sandbox = createPlaygroundSandbox();
    const states: boolean[] = [];
    const sub = sandbox.state$.subscribe((s) => states.push(s.isRunning));
    await sandbox.run('return 1');
    sub.unsubscribe();
    // Initial false, then true (running), then false (done)
    expect(states).toContain(true);
    expect(states[states.length - 1]).toBe(false);
    sandbox.destroy();
  });

  it('should handle errors in execution', async () => {
    const sandbox = createPlaygroundSandbox();
    await sandbox.run('throw new Error("fail")');
    expect(sandbox.state.error).toBe('fail');
    sandbox.destroy();
  });

  it('should clear output', async () => {
    const sandbox = createPlaygroundSandbox();
    await sandbox.run('console.log("test")');
    expect(sandbox.state.output.length).toBeGreaterThan(0);
    sandbox.clearOutput();
    expect(sandbox.state.output).toEqual([]);
    expect(sandbox.state.error).toBeNull();
    sandbox.destroy();
  });

  it('should set and get code', () => {
    const sandbox = createPlaygroundSandbox();
    sandbox.setCode('return 42');
    expect(sandbox.getCode()).toBe('return 42');
    expect(sandbox.state.code).toBe('return 42');
    sandbox.destroy();
  });

  it('should validate syntax', () => {
    const sandbox = createPlaygroundSandbox();
    sandbox.setCode('const x = 1;');
    expect(sandbox.validateSyntax().valid).toBe(true);
    sandbox.setCode('if (');
    expect(sandbox.validateSyntax().valid).toBe(false);
    sandbox.destroy();
  });

  it('should maintain execution history', async () => {
    const sandbox = createPlaygroundSandbox();
    await sandbox.run('return 1');
    await sandbox.run('return 2');
    await sandbox.run('return 3');
    const history = sandbox.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0]).toBe('return 1');
    expect(history[2]).toBe('return 3');
    sandbox.destroy();
  });

  it('should limit history size', async () => {
    const sandbox = createPlaygroundSandbox({ maxHistory: 2 });
    await sandbox.run('return 1');
    await sandbox.run('return 2');
    await sandbox.run('return 3');
    const history = sandbox.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toBe('return 2');
    sandbox.destroy();
  });

  it('should not add empty code to history', async () => {
    const sandbox = createPlaygroundSandbox();
    await sandbox.run('   ');
    expect(sandbox.getHistory()).toHaveLength(0);
    sandbox.destroy();
  });
});

describe('ExampleTemplates', () => {
  it('should return all templates', () => {
    const templates = createExampleTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(5);
  });

  it('should find template by name', () => {
    const t = getTemplateByName('hello-world');
    expect(t).toBeTruthy();
    expect(t!.title).toBe('Hello Pocket');
    expect(t!.code).toContain('docs');
  });

  it('should return undefined for unknown template', () => {
    expect(getTemplateByName('nonexistent')).toBeUndefined();
  });

  it('should filter by category', () => {
    const starters = getTemplatesByCategory('getting-started');
    expect(starters.length).toBeGreaterThanOrEqual(2);
    starters.forEach((t) => expect(t.category).toBe('getting-started'));
  });

  it('should filter by tag', () => {
    const syncTemplates = getTemplatesByTag('sync');
    expect(syncTemplates.length).toBeGreaterThanOrEqual(1);
    syncTemplates.forEach((t) => expect(t.tags).toContain('sync'));
  });

  it('each template should have required fields', () => {
    const templates = createExampleTemplates();
    for (const t of templates) {
      expect(t.name).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.code).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.tags.length).toBeGreaterThan(0);
    }
  });

  it('each template code should be executable', async () => {
    const { createCodeExecutor } = await import('../executor.js');
    const executor = createCodeExecutor({ timeoutMs: 2000 });
    const templates = createExampleTemplates();
    for (const t of templates) {
      const result = await executor.execute(t.code);
      expect(result.success).toBe(true);
    }
  });
});

describe('PlaygroundConfig', () => {
  it('should create default config', () => {
    const config = createPlaygroundConfig();
    expect(config.theme.name).toBe('auto');
    expect(config.features.autoRun).toBe(false);
    expect(config.features.maxExecutionTimeMs).toBe(5000);
  });

  it('should merge overrides', () => {
    const config = createPlaygroundConfig({
      theme: { name: 'dark' },
      features: { autoRun: true },
    });
    expect(config.theme.name).toBe('dark');
    expect(config.theme.fontFamily).toBe('monospace');
    expect(config.features.autoRun).toBe(true);
    expect(config.features.showOutput).toBe(true);
  });
});

describe('EmbedConfig', () => {
  it('should create default embed config', () => {
    const config = createEmbedConfig();
    expect(config.width).toBe('100%');
    expect(config.height).toBe('400px');
    expect(config.hideHeader).toBe(false);
    expect(config.hideToolbar).toBe(false);
  });

  it('should accept embed-specific overrides', () => {
    const config = createEmbedConfig({
      width: '600px',
      height: '300px',
      initialTemplate: 'hello-world',
      hideHeader: true,
    });
    expect(config.width).toBe('600px');
    expect(config.initialTemplate).toBe('hello-world');
    expect(config.hideHeader).toBe(true);
  });
});
