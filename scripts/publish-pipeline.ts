/**
 * PublishPipeline — Automated multi-package npm publish orchestration.
 *
 * Handles topological package ordering, pre-publish verification,
 * version management, and quality gate enforcement.
 */

// ── Types ──────────────────────────────────────────────────

export interface PublishPipelineConfig {
  /** Package registry URL (default: https://registry.npmjs.org) */
  registryUrl?: string;
  /** Dry run mode — validate without publishing (default: false) */
  dryRun?: boolean;
  /** Run quality gates before publish (default: true) */
  runQualityGates?: boolean;
  /** Fail on size-limit violations (default: true) */
  enforceSizeLimit?: boolean;
  /** Packages to exclude from publishing */
  excludePackages?: string[];
}

export interface PackageInfo {
  name: string;
  version: string;
  path: string;
  private: boolean;
  dependencies: string[];
  hasTests: boolean;
  hasBuild: boolean;
  sizeBytes: number | null;
}

export interface QualityGateResult {
  gate: string;
  passed: boolean;
  message: string;
  duration: number;
}

export interface PublishResult {
  package: string;
  version: string;
  published: boolean;
  skipped: boolean;
  error: string | null;
  qualityGates: QualityGateResult[];
}

export interface PipelineResult {
  packages: PublishResult[];
  totalPublished: number;
  totalSkipped: number;
  totalFailed: number;
  durationMs: number;
  dryRun: boolean;
  publishOrder: string[];
}

// ── Implementation ────────────────────────────────────────

export class PublishOrchestrator {
  private readonly config: Required<PublishPipelineConfig>;

  constructor(config: PublishPipelineConfig = {}) {
    this.config = {
      registryUrl: config.registryUrl ?? 'https://registry.npmjs.org',
      dryRun: config.dryRun ?? false,
      runQualityGates: config.runQualityGates ?? true,
      enforceSizeLimit: config.enforceSizeLimit ?? true,
      excludePackages: config.excludePackages ?? [],
    };
  }

  /**
   * Determine the topological publish order for packages.
   */
  getPublishOrder(packages: PackageInfo[]): string[] {
    const graph = new Map<string, string[]>();
    const allNames = new Set(packages.map((p) => p.name));

    for (const pkg of packages) {
      graph.set(
        pkg.name,
        pkg.dependencies.filter((d) => allNames.has(d))
      );
    }

    const order: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) return; // circular — skip
      visiting.add(name);

      for (const dep of graph.get(name) ?? []) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const pkg of packages) {
      visit(pkg.name);
    }

    return order;
  }

  /**
   * Run quality gates for a package.
   */
  runQualityGates(pkg: PackageInfo): QualityGateResult[] {
    const results: QualityGateResult[] = [];

    // Gate 1: Has build artifacts
    results.push({
      gate: 'build',
      passed: pkg.hasBuild,
      message: pkg.hasBuild
        ? 'Build artifacts present'
        : 'Missing build artifacts — run `pnpm build` first',
      duration: 0,
    });

    // Gate 2: Has tests
    results.push({
      gate: 'tests',
      passed: pkg.hasTests,
      message: pkg.hasTests ? 'Test suite present' : 'No tests found — add tests before publishing',
      duration: 0,
    });

    // Gate 3: Not private
    results.push({
      gate: 'public',
      passed: !pkg.private,
      message: pkg.private ? 'Package is marked private' : 'Package is publishable',
      duration: 0,
    });

    // Gate 4: Version is set
    results.push({
      gate: 'version',
      passed: pkg.version !== '0.0.0',
      message:
        pkg.version !== '0.0.0'
          ? `Version: ${pkg.version}`
          : 'Version is 0.0.0 — bump before publishing',
      duration: 0,
    });

    // Gate 5: Size limit
    if (this.config.enforceSizeLimit && pkg.sizeBytes !== null) {
      const maxSize = 100 * 1024; // 100KB default limit
      results.push({
        gate: 'size-limit',
        passed: pkg.sizeBytes <= maxSize,
        message:
          pkg.sizeBytes <= maxSize
            ? `Bundle: ${(pkg.sizeBytes / 1024).toFixed(1)}KB (within limit)`
            : `Bundle: ${(pkg.sizeBytes / 1024).toFixed(1)}KB (exceeds ${maxSize / 1024}KB limit)`,
        duration: 0,
      });
    }

    return results;
  }

  /**
   * Execute the publish pipeline for all packages.
   */
  async publish(packages: PackageInfo[]): Promise<PipelineResult> {
    const start = performance.now();
    const publishable = packages.filter(
      (p) => !p.private && !this.config.excludePackages.includes(p.name)
    );

    const order = this.getPublishOrder(publishable);
    const results: PublishResult[] = [];
    let published = 0;
    let skipped = 0;
    const failed = 0;

    for (const name of order) {
      const pkg = publishable.find((p) => p.name === name);
      if (!pkg) continue;

      const gates = this.config.runQualityGates ? this.runQualityGates(pkg) : [];
      const allGatesPassed = gates.every((g) => g.passed);

      if (!allGatesPassed) {
        results.push({
          package: name,
          version: pkg.version,
          published: false,
          skipped: true,
          error: `Quality gates failed: ${gates
            .filter((g) => !g.passed)
            .map((g) => g.gate)
            .join(', ')}`,
          qualityGates: gates,
        });
        skipped++;
        continue;
      }

      if (this.config.dryRun) {
        results.push({
          package: name,
          version: pkg.version,
          published: false,
          skipped: false,
          error: null,
          qualityGates: gates,
        });
        skipped++;
        continue;
      }

      // Simulate publish (in production, calls `npm publish`)
      results.push({
        package: name,
        version: pkg.version,
        published: true,
        skipped: false,
        error: null,
        qualityGates: gates,
      });
      published++;
    }

    return {
      packages: results,
      totalPublished: published,
      totalSkipped: skipped,
      totalFailed: failed,
      durationMs: performance.now() - start,
      dryRun: this.config.dryRun,
      publishOrder: order,
    };
  }

  /**
   * Format pipeline results for terminal display.
   */
  formatResults(result: PipelineResult): string {
    const lines: string[] = [];
    lines.push(`\n  Pocket Publish Pipeline${result.dryRun ? ' (DRY RUN)' : ''}`);
    lines.push('  ' + '═'.repeat(40));

    for (const pkg of result.packages) {
      const icon = pkg.published ? '✓' : pkg.skipped ? '○' : '✗';
      const status = pkg.published ? 'published' : pkg.error ? `skipped: ${pkg.error}` : 'dry-run';
      lines.push(`  ${icon} ${pkg.package}@${pkg.version} — ${status}`);
    }

    lines.push('  ' + '─'.repeat(40));
    lines.push(
      `  Published: ${result.totalPublished} | Skipped: ${result.totalSkipped} | Failed: ${result.totalFailed}`
    );
    lines.push(`  Duration: ${result.durationMs.toFixed(0)}ms`);
    lines.push(`  Order: ${result.publishOrder.join(' → ')}\n`);

    return lines.join('\n');
  }
}

export function createPublishOrchestrator(config?: PublishPipelineConfig): PublishOrchestrator {
  return new PublishOrchestrator(config);
}
