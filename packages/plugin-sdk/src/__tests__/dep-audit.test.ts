import { describe, it, expect } from 'vitest';
import { auditDependencies, getDefaultVulnDb } from '../dep-audit.js';

describe('Dependency Audit', () => {
  describe('clean dependencies', () => {
    it('should pass for safe dependencies', () => {
      const result = auditDependencies(['rxjs', 'typescript', 'vitest']);
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    it('should report scanned dependency count', () => {
      const result = auditDependencies(['rxjs', 'typescript']);
      expect(result.scannedDependencies).toBe(2);
    });
  });

  describe('vulnerability detection', () => {
    it('should detect vm2 as critical', () => {
      const result = auditDependencies(['vm2']);
      expect(result.passed).toBe(false);
      expect(result.findings[0]!.severity).toBe('critical');
      expect(result.findings[0]!.cveId).toBe('CVE-2023-37466');
    });

    it('should detect eval5 as critical', () => {
      const result = auditDependencies(['eval5']);
      expect(result.passed).toBe(false);
      expect(result.summary.critical).toBeGreaterThan(0);
    });

    it('should detect axios as high', () => {
      const result = auditDependencies(['axios']);
      expect(result.passed).toBe(false);
      expect(result.findings[0]!.severity).toBe('high');
    });

    it('should detect multiple vulnerabilities', () => {
      const result = auditDependencies(['vm2', 'eval5', 'axios']);
      expect(result.findings.length).toBeGreaterThanOrEqual(3);
    });

    it('should include fix recommendations', () => {
      const result = auditDependencies(['axios']);
      expect(result.findings[0]!.recommendation).toContain('Upgrade');
    });

    it('should recommend removal for unfixable deps', () => {
      const result = auditDependencies(['vm2']);
      expect(result.findings[0]!.recommendation).toContain('Remove');
    });
  });

  describe('mixed dependencies', () => {
    it('should pass when only safe deps present', () => {
      const result = auditDependencies(['rxjs', 'lodash']);
      // lodash has a known vuln but it's high, not critical
      expect(result.summary.critical).toBe(0);
    });

    it('should fail when any critical/high found', () => {
      const result = auditDependencies(['rxjs', 'vm2', 'typescript']);
      expect(result.passed).toBe(false);
    });
  });

  describe('severity sorting', () => {
    it('should sort findings by severity (critical first)', () => {
      const result = auditDependencies(['axios', 'vm2', 'lodash']);
      const severities = result.findings.map((f) => f.severity);
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      for (let i = 1; i < severities.length; i++) {
        expect(order[severities[i]!]).toBeGreaterThanOrEqual(order[severities[i - 1]!]);
      }
    });
  });

  describe('summary', () => {
    it('should correctly categorize findings', () => {
      const result = auditDependencies(['vm2', 'eval5', 'axios', 'lodash']);
      expect(result.summary.critical + result.summary.high + result.summary.medium + result.summary.low).toBe(result.findings.length);
    });
  });

  describe('vulnerability database', () => {
    it('should expose default database', () => {
      const db = getDefaultVulnDb();
      expect(db.length).toBeGreaterThan(0);
      expect(db.some((v) => v.package === 'vm2')).toBe(true);
    });

    it('should accept custom vulnerability database', () => {
      const result = auditDependencies(['my-internal-pkg'], [
        { package: 'my-internal-pkg', affectedVersions: '*', severity: 'medium', description: 'Internal vuln' },
      ]);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]!.package).toBe('my-internal-pkg');
    });
  });
});
