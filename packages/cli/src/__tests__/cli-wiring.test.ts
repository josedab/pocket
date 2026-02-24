import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('CLI binary wiring', () => {
  const cliSource = readFileSync(resolve(__dirname, '../cli.ts'), 'utf-8');

  it('should import scaffold command', () => {
    expect(cliSource).toContain("import { scaffold } from './commands/scaffold.js'");
  });

  it('should import diagnostics commands', () => {
    expect(cliSource).toContain(
      "import { formatBenchmarkReport, runBenchmark, runHealthCheck } from './commands/diagnostics.js'"
    );
  });

  it('should register "new" command in switch statement', () => {
    expect(cliSource).toContain("case 'new':");
  });

  it('should register "health" command in switch statement', () => {
    expect(cliSource).toContain("case 'health':");
  });

  it('should register "bench" command in switch statement', () => {
    expect(cliSource).toContain("case 'bench':");
  });

  it('should include new commands in help text', () => {
    expect(cliSource).toContain('Scaffold a new Pocket project');
    expect(cliSource).toContain('Run health checks on project setup');
    expect(cliSource).toContain('Run performance benchmarks');
  });

  it('should include new examples in help text', () => {
    expect(cliSource).toContain('pocket new my-app --template react');
    expect(cliSource).toContain('pocket health');
    expect(cliSource).toContain('pocket bench');
  });
});
