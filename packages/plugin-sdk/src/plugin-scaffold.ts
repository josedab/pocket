/**
 * @module PluginScaffold
 *
 * Plugin scaffolding generator, quality scoring engine, compatibility matrix,
 * and publishing pipeline for the Pocket plugin ecosystem.
 *
 * @example
 * ```typescript
 * const scaffold = createPluginScaffold();
 * const files = scaffold.generate({ name: 'my-plugin', category: 'sync', author: 'me' });
 * const score = scaffold.score(manifest, { hasTests: true, hasReadme: true });
 * const compat = scaffold.checkCompatibility(manifest, '0.5.0');
 * ```
 */

import { BehaviorSubject, Subject } from 'rxjs';
import type { PluginCategory, PluginManifest } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Template options for scaffolding */
export interface ScaffoldOptions {
  readonly name: string;
  readonly category: PluginCategory;
  readonly author: string;
  readonly description?: string;
  readonly pocketVersion?: string;
  readonly license?: string;
  readonly hooks?: string[];
}

/** Generated file from scaffolding */
export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

/** Quality score breakdown */
export interface QualityScore {
  readonly overall: number;
  readonly breakdown: {
    readonly documentation: number;
    readonly testing: number;
    readonly metadata: number;
    readonly codeQuality: number;
    readonly compatibility: number;
  };
  readonly suggestions: string[];
}

/** Quality assessment input */
export interface QualityInput {
  readonly hasReadme?: boolean;
  readonly hasChangelog?: boolean;
  readonly hasTests?: boolean;
  readonly testCount?: number;
  readonly hasTypeDefinitions?: boolean;
  readonly hasExamples?: boolean;
  readonly codeLines?: number;
  readonly dependencyCount?: number;
}

/** Compatibility check result */
export interface CompatibilityResult {
  readonly compatible: boolean;
  readonly targetVersion: string;
  readonly pluginVersion: string;
  readonly issues: string[];
  readonly warnings: string[];
}

/** Publish pipeline stage */
export type PublishStage = 'validate' | 'build' | 'test' | 'package' | 'sign' | 'publish';

/** Publish pipeline result */
export interface PublishResult {
  readonly success: boolean;
  readonly stages: {
    readonly stage: PublishStage;
    readonly success: boolean;
    readonly error?: string;
    readonly durationMs: number;
  }[];
  readonly totalDurationMs: number;
  readonly packageId?: string;
}

/** Publish pipeline progress */
export interface PublishProgress {
  readonly stage: PublishStage;
  readonly status: 'running' | 'complete' | 'failed';
  readonly progress: number;
}

// ---------------------------------------------------------------------------
// PluginScaffold
// ---------------------------------------------------------------------------

export class PluginScaffold {
  private readonly _progress$ = new BehaviorSubject<PublishProgress | null>(null);
  private readonly _destroy$ = new Subject<void>();

  /** Observable of publish progress */
  readonly progress$ = this._progress$.asObservable();

  /** Generate scaffold files for a new plugin */
  generate(options: ScaffoldOptions): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const pkgName = `pocket-plugin-${options.name}`;

    // package.json
    files.push({
      path: 'package.json',
      content: JSON.stringify(
        {
          name: pkgName,
          version: '0.1.0',
          description: options.description ?? `Pocket ${options.category} plugin: ${options.name}`,
          main: 'dist/index.js',
          types: 'dist/index.d.ts',
          license: options.license ?? 'MIT',
          author: options.author,
          scripts: {
            build: 'tsup src/index.ts --format cjs,esm --dts',
            test: 'vitest run',
            lint: 'eslint src/',
          },
          peerDependencies: {
            '@pocket/core': `^${options.pocketVersion ?? '0.1.0'}`,
          },
          devDependencies: {
            '@pocket/plugin-sdk': '^0.1.0',
            tsup: '^8.0.0',
            typescript: '^5.0.0',
            vitest: '^3.0.0',
          },
          pocket: {
            category: options.category,
            hooks: options.hooks ?? [],
          },
        },
        null,
        2
      ),
    });

    // manifest.json
    files.push({
      path: 'manifest.json',
      content: JSON.stringify(
        {
          name: options.name,
          version: '0.1.0',
          description: options.description ?? `A ${options.category} plugin for Pocket`,
          author: options.author,
          category: options.category,
          pocketVersion: options.pocketVersion ?? '>=0.1.0',
          entryPoint: 'dist/index.js',
          hooks: options.hooks ?? [],
          permissions: [],
        },
        null,
        2
      ),
    });

    // src/index.ts
    const hookImports =
      (options.hooks ?? []).length > 0 ? `\n// Hooks: ${(options.hooks ?? []).join(', ')}` : '';

    files.push({
      path: 'src/index.ts',
      content: `/**
 * ${pkgName}
 * ${options.description ?? `A ${options.category} plugin for Pocket`}
 */
${hookImports}

export interface ${this._pascalCase(options.name)}Config {
  readonly enabled?: boolean;
}

export function activate(config: ${this._pascalCase(options.name)}Config = {}): void {
  const _enabled = config.enabled ?? true;
  if (!_enabled) return;
  // Plugin activation logic
}

export function deactivate(): void {
  // Plugin deactivation logic
}
`,
    });

    // src/__tests__/index.test.ts
    files.push({
      path: 'src/__tests__/index.test.ts',
      content: `import { describe, it, expect } from 'vitest';
import { activate, deactivate } from '../index.js';

describe('${options.name}', () => {
  it('should activate without errors', () => {
    expect(() => activate()).not.toThrow();
  });

  it('should deactivate without errors', () => {
    expect(() => deactivate()).not.toThrow();
  });

  it('should respect enabled config', () => {
    expect(() => activate({ enabled: false })).not.toThrow();
  });
});
`,
    });

    // tsconfig.json
    files.push({
      path: 'tsconfig.json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            declaration: true,
            outDir: 'dist',
            rootDir: 'src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src'],
        },
        null,
        2
      ),
    });

    // README.md
    files.push({
      path: 'README.md',
      content: `# ${pkgName}

${options.description ?? `A ${options.category} plugin for Pocket`}

## Installation

\`\`\`bash
npm install ${pkgName}
\`\`\`

## Usage

\`\`\`typescript
import { activate } from '${pkgName}';

activate({ enabled: true });
\`\`\`

## License

${options.license ?? 'MIT'}
`,
    });

    // CHANGELOG.md
    files.push({
      path: 'CHANGELOG.md',
      content: `# Changelog

## 0.1.0

- Initial release
`,
    });

    return files;
  }

  /** Score plugin quality on a 0-100 scale */
  score(manifest: PluginManifest, input: QualityInput = {}): QualityScore {
    const suggestions: string[] = [];

    // Documentation score (0-25)
    let documentation = 0;
    if (input.hasReadme) documentation += 10;
    else suggestions.push('Add a README.md with usage examples');
    if (input.hasChangelog) documentation += 5;
    else suggestions.push('Add a CHANGELOG.md');
    if (input.hasExamples) documentation += 5;
    else suggestions.push('Add usage examples');
    if (manifest.description && manifest.description.length > 20) documentation += 5;
    else suggestions.push('Provide a detailed description (>20 chars)');

    // Testing score (0-25)
    let testing = 0;
    if (input.hasTests) {
      testing += 10;
      const count = input.testCount ?? 0;
      if (count >= 10) testing += 10;
      else if (count >= 5) testing += 7;
      else if (count >= 1) testing += 3;
      testing += 5; // Has test infrastructure
    } else {
      suggestions.push('Add tests for your plugin');
    }

    // Metadata score (0-20)
    let metadata = 0;
    if (manifest.name) metadata += 4;
    if (manifest.version) metadata += 4;
    if (manifest.author) metadata += 4;
    if (manifest.category) metadata += 4;
    if (manifest.pocketVersion) metadata += 4;
    else suggestions.push('Specify pocketVersion compatibility');

    // Code quality score (0-15)
    let codeQuality = 0;
    if (input.hasTypeDefinitions) codeQuality += 5;
    else suggestions.push('Include TypeScript type definitions');
    const deps = input.dependencyCount ?? 0;
    if (deps <= 3) codeQuality += 5;
    else if (deps <= 8) codeQuality += 3;
    else suggestions.push('Reduce dependency count for smaller bundle');
    const lines = input.codeLines ?? 0;
    if (lines > 0 && lines < 5000) codeQuality += 5;
    else if (lines > 0) codeQuality += 3;

    // Compatibility (0-15)
    let compatibility = 0;
    if (manifest.pocketVersion) compatibility += 10;
    if (manifest.category) compatibility += 5;

    const overall = documentation + testing + metadata + codeQuality + compatibility;

    return {
      overall,
      breakdown: {
        documentation,
        testing,
        metadata,
        codeQuality,
        compatibility,
      },
      suggestions,
    };
  }

  /** Check compatibility with a Pocket version */
  checkCompatibility(manifest: PluginManifest, targetVersion: string): CompatibilityResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    if (!manifest.pocketVersion) {
      issues.push('Plugin does not specify pocketVersion');
    } else {
      const required = this._parseVersion(manifest.pocketVersion.replace(/[>=^~]/g, ''));
      const target = this._parseVersion(targetVersion);

      if (required.major > target.major) {
        issues.push(
          `Plugin requires Pocket ${manifest.pocketVersion}, but target is ${targetVersion}`
        );
      } else if (required.major < target.major) {
        warnings.push('Plugin was built for an older major version; some APIs may have changed');
      } else if (required.minor > target.minor) {
        warnings.push(`Plugin prefers Pocket ${manifest.pocketVersion}; minor version mismatch`);
      }
    }

    return {
      compatible: issues.length === 0,
      targetVersion,
      pluginVersion: manifest.version,
      issues,
      warnings,
    };
  }

  /** Simulate a publish pipeline */
  async publish(manifest: PluginManifest, input: QualityInput = {}): Promise<PublishResult> {
    const stages: PublishStage[] = ['validate', 'build', 'test', 'package', 'sign', 'publish'];
    const results: PublishResult['stages'] = [];
    const t0 = Date.now();
    let success = true;

    for (const stage of stages) {
      this._progress$.next({ stage, status: 'running', progress: 0 });
      const stageStart = Date.now();
      let stageSuccess = true;
      let error: string | undefined;

      try {
        this._progress$.next({ stage, status: 'running', progress: 50 });
        await this._executeStage(stage, manifest, input);
        this._progress$.next({ stage, status: 'complete', progress: 100 });
      } catch (e) {
        stageSuccess = false;
        success = false;
        error = e instanceof Error ? e.message : String(e);
        this._progress$.next({ stage, status: 'failed', progress: 0 });
      }

      results.push({
        stage,
        success: stageSuccess,
        error,
        durationMs: Date.now() - stageStart,
      });

      if (!stageSuccess) break;
    }

    this._progress$.next(null);

    return {
      success,
      stages: results,
      totalDurationMs: Date.now() - t0,
      packageId: success ? `${manifest.name}@${manifest.version}` : undefined,
    };
  }

  /** Clean up */
  destroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
    this._progress$.complete();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async _executeStage(
    stage: PublishStage,
    manifest: PluginManifest,
    input: QualityInput
  ): Promise<void> {
    switch (stage) {
      case 'validate': {
        if (!manifest.name) throw new Error('Manifest missing name');
        if (!manifest.version) throw new Error('Manifest missing version');
        if (!manifest.author) throw new Error('Manifest missing author');
        break;
      }
      case 'build':
        // Simulate build
        break;
      case 'test': {
        const score = this.score(manifest, input);
        if (score.overall < 20) {
          throw new Error(`Quality score too low: ${score.overall}/100 (minimum: 20)`);
        }
        break;
      }
      case 'package':
        // Simulate packaging
        break;
      case 'sign':
        // Simulate signing
        break;
      case 'publish':
        // Simulate publish
        break;
    }
  }

  private _pascalCase(s: string): string {
    return s
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }

  private _parseVersion(version: string): { major: number; minor: number; patch: number } {
    const parts = version.split('.').map(Number);
    return {
      major: parts[0] ?? 0,
      minor: parts[1] ?? 0,
      patch: parts[2] ?? 0,
    };
  }
}

/** Factory function */
export function createPluginScaffold(): PluginScaffold {
  return new PluginScaffold();
}
