/**
 * SecurityScanner - Static analysis security scanner for Pocket plugins.
 *
 * Analyzes plugin source code and manifests for security issues including
 * unsafe API usage, permission escalation, data exfiltration patterns,
 * and dependency vulnerabilities.
 *
 * @module security-scanner
 */

import type { PluginManifest } from './types.js';

/** Severity level for security findings */
export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Category of security finding */
export type SecurityCategory =
  | 'unsafe-api'
  | 'data-exfiltration'
  | 'permission-escalation'
  | 'dependency-risk'
  | 'code-injection'
  | 'resource-abuse'
  | 'privacy-violation';

/** A single security finding */
export interface SecurityFinding {
  readonly id: string;
  readonly severity: SecuritySeverity;
  readonly category: SecurityCategory;
  readonly title: string;
  readonly description: string;
  readonly location?: {
    readonly file: string;
    readonly line?: number;
    readonly column?: number;
  };
  readonly recommendation: string;
  readonly cweId?: string;
}

/** Security scan configuration */
export interface SecurityScannerConfig {
  /** Patterns to check for (overrides defaults) */
  readonly customPatterns?: readonly SecurityPattern[];
  /** Severity threshold — findings below this are excluded */
  readonly minSeverity?: SecuritySeverity;
  /** Maximum scan duration in ms */
  readonly timeoutMs?: number;
  /** Scan dependencies for known vulnerabilities */
  readonly scanDependencies?: boolean;
}

/** A pattern to check for in source code */
export interface SecurityPattern {
  readonly id: string;
  readonly pattern: RegExp;
  readonly severity: SecuritySeverity;
  readonly category: SecurityCategory;
  readonly title: string;
  readonly description: string;
  readonly recommendation: string;
  readonly cweId?: string;
}

/** Full security scan result */
export interface SecurityScanResult {
  readonly passed: boolean;
  readonly findings: readonly SecurityFinding[];
  readonly summary: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
    readonly total: number;
  };
  readonly scannedFiles: number;
  readonly scannedLines: number;
  readonly durationMs: number;
  readonly timestamp: number;
}

/** Input for scanning a plugin */
export interface PluginScanInput {
  readonly manifest: PluginManifest;
  /** Map of file paths to source content */
  readonly sourceFiles: ReadonlyMap<string, string>;
  /** List of npm dependencies */
  readonly dependencies?: readonly string[];
}

// ── Default Patterns ─────────────────────────────────────────────────────────

const DEFAULT_PATTERNS: SecurityPattern[] = [
  {
    id: 'eval-usage',
    pattern: /\beval\s*\(/g,
    severity: 'critical',
    category: 'code-injection',
    title: 'Use of eval()',
    description: 'eval() can execute arbitrary code and is a major security risk',
    recommendation: 'Use JSON.parse() or a safe expression evaluator instead',
    cweId: 'CWE-95',
  },
  {
    id: 'function-constructor',
    pattern: /new\s+Function\s*\(/g,
    severity: 'critical',
    category: 'code-injection',
    title: 'Use of Function constructor',
    description: 'The Function constructor can execute arbitrary code similar to eval()',
    recommendation: 'Avoid dynamic code generation; use static functions',
    cweId: 'CWE-95',
  },
  {
    id: 'fetch-external',
    pattern: /fetch\s*\(\s*['"`]https?:\/\//g,
    severity: 'high',
    category: 'data-exfiltration',
    title: 'External network request detected',
    description: 'Plugin makes requests to external URLs which could exfiltrate data',
    recommendation: 'Ensure external requests are necessary and documented in manifest',
    cweId: 'CWE-200',
  },
  {
    id: 'localstorage-access',
    pattern: /localStorage\s*\.\s*(setItem|getItem|removeItem|clear)/g,
    severity: 'medium',
    category: 'unsafe-api',
    title: 'Direct localStorage access',
    description: 'Plugin directly accesses localStorage outside of Pocket storage APIs',
    recommendation: 'Use Pocket storage adapters instead of raw localStorage',
  },
  {
    id: 'document-cookie',
    pattern: /document\s*\.\s*cookie/g,
    severity: 'high',
    category: 'privacy-violation',
    title: 'Cookie access detected',
    description: 'Plugin reads or writes browser cookies',
    recommendation: 'Avoid cookie access; use Pocket auth mechanisms instead',
    cweId: 'CWE-565',
  },
  {
    id: 'innerhtml-usage',
    pattern: /\.innerHTML\s*=/g,
    severity: 'high',
    category: 'code-injection',
    title: 'innerHTML assignment detected',
    description: 'Setting innerHTML can lead to XSS vulnerabilities',
    recommendation: 'Use textContent or a sanitization library',
    cweId: 'CWE-79',
  },
  {
    id: 'hardcoded-secret',
    pattern: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"`][A-Za-z0-9+/=]{16,}/gi,
    severity: 'critical',
    category: 'data-exfiltration',
    title: 'Possible hardcoded secret',
    description: 'A string that looks like a secret or API key is hardcoded in the source',
    recommendation: 'Use environment variables or secure vaults for secrets',
    cweId: 'CWE-798',
  },
  {
    id: 'prototype-pollution',
    pattern: /__proto__|Object\.prototype\s*\[/g,
    severity: 'high',
    category: 'code-injection',
    title: 'Prototype pollution risk',
    description: 'Code references __proto__ or modifies Object.prototype',
    recommendation: 'Use Object.create(null) or Map for dynamic keys',
    cweId: 'CWE-1321',
  },
  {
    id: 'excessive-permissions',
    pattern: /\*\s*:\s*\*/g,
    severity: 'medium',
    category: 'permission-escalation',
    title: 'Wildcard permission request',
    description: 'Plugin requests wildcard permissions',
    recommendation: 'Request only the specific permissions needed',
  },
  {
    id: 'setinterval-unbounded',
    pattern: /setInterval\s*\([^)]+,\s*\d{1,3}\s*\)/g,
    severity: 'medium',
    category: 'resource-abuse',
    title: 'Very frequent setInterval detected',
    description: 'setInterval with interval < 1 second can cause performance issues',
    recommendation: 'Use intervals of at least 1000ms or requestAnimationFrame',
  },
];

const SEVERITY_ORDER: Record<SecuritySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const RISKY_DEPENDENCIES = new Set([
  'eval5', 'vm2', 'safe-eval', 'node-fetch', 'axios',
  'request', 'got', 'needle', 'superagent',
]);

/**
 * Scans Pocket plugins for security vulnerabilities.
 *
 * @example
 * ```typescript
 * import { createSecurityScanner } from '@pocket/plugin-sdk';
 *
 * const scanner = createSecurityScanner({ minSeverity: 'medium' });
 *
 * const result = scanner.scan({
 *   manifest: pluginManifest,
 *   sourceFiles: new Map([['src/index.ts', sourceCode]]),
 *   dependencies: ['rxjs', 'lodash'],
 * });
 *
 * if (!result.passed) {
 *   console.error(`${result.summary.critical} critical issues found`);
 *   for (const finding of result.findings) {
 *     console.log(`[${finding.severity}] ${finding.title}: ${finding.description}`);
 *   }
 * }
 * ```
 */
export class SecurityScanner {
  private readonly config: Required<Omit<SecurityScannerConfig, 'customPatterns'>> &
    Pick<SecurityScannerConfig, 'customPatterns'>;
  private readonly patterns: SecurityPattern[];

  constructor(config: SecurityScannerConfig = {}) {
    this.config = {
      minSeverity: config.minSeverity ?? 'low',
      timeoutMs: config.timeoutMs ?? 30_000,
      scanDependencies: config.scanDependencies ?? true,
      ...config,
    };
    this.patterns = config.customPatterns
      ? [...config.customPatterns]
      : [...DEFAULT_PATTERNS];
  }

  /** Scan a plugin for security issues */
  scan(input: PluginScanInput): SecurityScanResult {
    const start = Date.now();
    const findings: SecurityFinding[] = [];
    let scannedLines = 0;

    // Scan source files against patterns
    for (const [filePath, content] of input.sourceFiles) {
      const lines = content.split('\n');
      scannedLines += lines.length;

      for (const pattern of this.patterns) {
        if (!this.meetsMinSeverity(pattern.severity)) continue;

        // Reset regex state for each file
        const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split('\n').length;
          findings.push({
            id: `${pattern.id}-${filePath}-${lineNumber}`,
            severity: pattern.severity,
            category: pattern.category,
            title: pattern.title,
            description: pattern.description,
            location: { file: filePath, line: lineNumber },
            recommendation: pattern.recommendation,
            cweId: pattern.cweId,
          });
        }
      }
    }

    // Scan dependencies
    if (this.config.scanDependencies && input.dependencies) {
      for (const dep of input.dependencies) {
        if (RISKY_DEPENDENCIES.has(dep)) {
          findings.push({
            id: `risky-dep-${dep}`,
            severity: 'medium',
            category: 'dependency-risk',
            title: `Risky dependency: ${dep}`,
            description: `The dependency "${dep}" is flagged as potentially risky for plugin use`,
            recommendation: `Evaluate if "${dep}" is necessary; consider alternatives`,
          });
        }
      }
    }

    // Sort by severity
    findings.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );

    const summary = {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
      total: findings.length,
    };

    return {
      passed: summary.critical === 0 && summary.high === 0,
      findings,
      summary,
      scannedFiles: input.sourceFiles.size,
      scannedLines,
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    };
  }

  /** Quick check — returns true if the plugin passes security scan */
  quickCheck(input: PluginScanInput): boolean {
    return this.scan(input).passed;
  }

  /** Add a custom security pattern */
  addPattern(pattern: SecurityPattern): void {
    this.patterns.push(pattern);
  }

  /** Get all configured patterns */
  getPatterns(): readonly SecurityPattern[] {
    return this.patterns;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private meetsMinSeverity(severity: SecuritySeverity): boolean {
    return SEVERITY_ORDER[severity] <= SEVERITY_ORDER[this.config.minSeverity];
  }
}

/** Factory function to create a SecurityScanner */
export function createSecurityScanner(config?: SecurityScannerConfig): SecurityScanner {
  return new SecurityScanner(config);
}
