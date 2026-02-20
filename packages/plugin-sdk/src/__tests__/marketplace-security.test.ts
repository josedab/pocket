import { describe, it, expect } from 'vitest';
import { reviewPluginSecurity, batchReviewPlugins } from '../marketplace-security.js';
import type { PluginScanInput } from '../security-scanner.js';

const CLEAN_SOURCE = 'export const plugin = { name: "test", install() {} };';
const UNSAFE_SOURCE = 'const x = eval("1+1"); fetch("https://evil.com");';

function makeInput(source = CLEAN_SOURCE, deps: string[] = []): PluginScanInput {
  return {
    manifest: {
      name: '@pocket/test',
      version: '1.0.0',
      description: 'Test',
      author: 'Author',
      category: 'data',
      pocketVersion: '>=0.1.0',
    },
    sourceFiles: new Map([['src/index.ts', source]]),
    dependencies: deps,
  };
}

describe('Marketplace Security Review', () => {
  describe('clean plugins', () => {
    it('should approve clean plugin', () => {
      const review = reviewPluginSecurity(makeInput());
      expect(review.passed).toBe(true);
      expect(review.recommendation).toBe('approve');
      expect(review.policyViolations).toHaveLength(0);
    });

    it('should include scan result', () => {
      const review = reviewPluginSecurity(makeInput());
      expect(review.scanResult).toBeDefined();
      expect(review.scanResult.passed).toBe(true);
    });

    it('should include plugin metadata', () => {
      const review = reviewPluginSecurity(makeInput());
      expect(review.pluginName).toBe('@pocket/test');
      expect(review.version).toBe('1.0.0');
    });

    it('should include timing', () => {
      const review = reviewPluginSecurity(makeInput());
      expect(review.reviewDurationMs).toBeGreaterThanOrEqual(0);
      expect(review.reviewedAt).toBeGreaterThan(0);
    });
  });

  describe('unsafe plugins', () => {
    it('should reject plugins with critical findings', () => {
      const review = reviewPluginSecurity(makeInput(UNSAFE_SOURCE));
      expect(review.passed).toBe(false);
      expect(review.recommendation).toBe('reject');
      expect(review.policyViolations.length).toBeGreaterThan(0);
    });

    it('should cite critical/high finding counts', () => {
      const review = reviewPluginSecurity(makeInput(UNSAFE_SOURCE));
      expect(review.policyViolations.some((v) => v.includes('critical'))).toBe(true);
    });
  });

  describe('blocked dependencies', () => {
    it('should flag blocked dependencies', () => {
      const review = reviewPluginSecurity(makeInput(CLEAN_SOURCE, ['eval5']));
      expect(review.passed).toBe(false);
      expect(review.policyViolations.some((v) => v.includes('eval5'))).toBe(true);
    });
  });

  describe('custom policy', () => {
    it('should respect custom max critical threshold', () => {
      const review = reviewPluginSecurity(makeInput(UNSAFE_SOURCE), { maxCritical: 10 });
      // With high threshold, critical findings won't violate
      // But high findings still may
      expect(review.policyViolations.filter((v) => v.includes('critical'))).toHaveLength(0);
    });
  });

  describe('batch review', () => {
    it('should review multiple plugins', () => {
      const results = batchReviewPlugins([
        makeInput(CLEAN_SOURCE),
        makeInput(UNSAFE_SOURCE),
      ]);
      expect(results).toHaveLength(2);
      expect(results[0]!.passed).toBe(true);
      expect(results[1]!.passed).toBe(false);
    });
  });
});
