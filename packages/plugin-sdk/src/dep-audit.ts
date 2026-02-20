/**
 * Dependency vulnerability audit for the plugin publish pipeline.
 *
 * Checks plugin dependencies against a configurable list of known
 * vulnerable packages and versions, producing an audit report.
 *
 * @module dep-audit
 */

/** A known vulnerability record */
export interface KnownVulnerability {
  readonly package: string;
  readonly affectedVersions: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly cveId?: string;
  readonly description: string;
  readonly fixedIn?: string;
}

/** Audit finding for a single dependency */
export interface DepAuditFinding {
  readonly package: string;
  readonly installedVersion?: string;
  readonly severity: KnownVulnerability['severity'];
  readonly cveId?: string;
  readonly description: string;
  readonly recommendation: string;
}

/** Full audit result */
export interface DepAuditResult {
  readonly passed: boolean;
  readonly findings: readonly DepAuditFinding[];
  readonly scannedDependencies: number;
  readonly summary: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly durationMs: number;
}

// Built-in vulnerability database (extendable)
const DEFAULT_VULN_DB: KnownVulnerability[] = [
  { package: 'lodash', affectedVersions: '<4.17.21', severity: 'high', cveId: 'CVE-2021-23337', description: 'Prototype pollution in lodash', fixedIn: '4.17.21' },
  { package: 'minimist', affectedVersions: '<1.2.6', severity: 'critical', cveId: 'CVE-2021-44906', description: 'Prototype pollution in minimist', fixedIn: '1.2.6' },
  { package: 'node-fetch', affectedVersions: '<2.6.7', severity: 'high', cveId: 'CVE-2022-0235', description: 'Exposure of sensitive information in node-fetch', fixedIn: '2.6.7' },
  { package: 'axios', affectedVersions: '<1.6.0', severity: 'high', cveId: 'CVE-2023-45857', description: 'CSRF vulnerability in axios', fixedIn: '1.6.0' },
  { package: 'jsonwebtoken', affectedVersions: '<9.0.0', severity: 'high', cveId: 'CVE-2022-23529', description: 'Insecure default algorithm in jsonwebtoken', fixedIn: '9.0.0' },
  { package: 'vm2', affectedVersions: '*', severity: 'critical', cveId: 'CVE-2023-37466', description: 'Sandbox escape in vm2', fixedIn: 'None - deprecated' },
  { package: 'eval5', affectedVersions: '*', severity: 'critical', description: 'Eval-based execution allows arbitrary code' },
  { package: 'shell-quote', affectedVersions: '<1.7.3', severity: 'high', cveId: 'CVE-2021-42740', description: 'Command injection in shell-quote', fixedIn: '1.7.3' },
];

/**
 * Audits plugin dependencies for known vulnerabilities.
 *
 * @example
 * ```typescript
 * import { auditDependencies } from '@pocket/plugin-sdk';
 *
 * const result = auditDependencies(['lodash', 'rxjs', 'vm2']);
 * if (!result.passed) {
 *   for (const f of result.findings) {
 *     console.log(`[${f.severity}] ${f.package}: ${f.description}`);
 *   }
 * }
 * ```
 */
export function auditDependencies(
  dependencies: readonly string[],
  customVulnDb?: readonly KnownVulnerability[],
): DepAuditResult {
  const start = Date.now();
  const vulnDb = customVulnDb ?? DEFAULT_VULN_DB;
  const findings: DepAuditFinding[] = [];

  const vulnMap = new Map<string, KnownVulnerability[]>();
  for (const vuln of vulnDb) {
    let list = vulnMap.get(vuln.package);
    if (!list) { list = []; vulnMap.set(vuln.package, list); }
    list.push(vuln);
  }

  for (const dep of dependencies) {
    // Parse package name (handle scoped packages and version specifiers)
    const pkgName = dep.replace(/@[\d^~>=<.*]+$/, '').trim();
    const vulns = vulnMap.get(pkgName);
    if (!vulns) continue;

    for (const vuln of vulns) {
      findings.push({
        package: pkgName,
        severity: vuln.severity,
        cveId: vuln.cveId,
        description: vuln.description,
        recommendation: vuln.fixedIn && !vuln.fixedIn.toLowerCase().includes('none')
          ? `Upgrade to ${vuln.fixedIn} or later`
          : `Remove ${pkgName} — no fix available`,
      });
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const summary = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
  };

  return {
    passed: summary.critical === 0 && summary.high === 0,
    findings,
    scannedDependencies: dependencies.length,
    summary,
    durationMs: Date.now() - start,
  };
}

/** Get the built-in vulnerability database */
export function getDefaultVulnDb(): readonly KnownVulnerability[] {
  return DEFAULT_VULN_DB;
}
