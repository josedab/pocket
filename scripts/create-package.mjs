#!/usr/bin/env node

/**
 * @module create-package
 * @description Scaffolds a new Pocket package with standard structure and conventions.
 *
 * @example
 * ```bash
 * node scripts/create-package.mjs my-feature
 * node scripts/create-package.mjs my-feature --description "My feature package"
 * node scripts/create-package.mjs my-feature --category extension --deps @pocket/sync
 * ```
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CATEGORIES = ['core', 'framework', 'storage', 'extension', 'tooling', 'platform', 'cloud'];

function parseArgs(args) {
  const result = { name: '', description: '', category: 'extension', deps: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--description' && args[i + 1]) {
      result.description = args[++i];
    } else if (arg === '--category' && args[i + 1]) {
      result.category = args[++i];
    } else if (arg === '--deps' && args[i + 1]) {
      result.deps = args[++i].split(',').map((d) => d.trim());
    } else if (!arg.startsWith('--') && !result.name) {
      result.name = arg;
    }
  }

  return result;
}

function validateArgs(opts) {
  if (!opts.name) {
    console.error('Usage: node scripts/create-package.mjs <name> [--description "..."] [--category extension] [--deps @pocket/sync]');
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(opts.name)) {
    console.error(`Error: Package name must be lowercase alphanumeric with hyphens. Got: "${opts.name}"`);
    process.exit(1);
  }

  if (!CATEGORIES.includes(opts.category)) {
    console.error(`Error: Category must be one of: ${CATEGORIES.join(', ')}. Got: "${opts.category}"`);
    process.exit(1);
  }
}

function generatePackageJson(name, description, category, deps) {
  const depEntries = { '@pocket/core': 'workspace:*', rxjs: '^7.8.1' };
  for (const dep of deps) {
    depEntries[dep] = dep.startsWith('@pocket/') ? 'workspace:*' : '*';
  }

  return JSON.stringify(
    {
      name: `@pocket/${name}`,
      version: '0.1.0',
      description: description || `${name} package for Pocket local-first database`,
      license: 'MIT',
      repository: {
        type: 'git',
        url: 'https://github.com/pocket-db/pocket',
        directory: `packages/${name}`,
      },
      homepage: 'https://pocket-db.dev',
      bugs: { url: 'https://github.com/pocket-db/pocket/issues' },
      engines: { node: '>=18.0.0' },
      type: 'module',
      main: './dist/index.cjs',
      module: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': {
          import: { types: './dist/index.d.ts', default: './dist/index.js' },
          require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
        },
      },
      files: ['dist'],
      scripts: {
        build: 'tsup',
        dev: 'tsup --watch',
        typecheck: 'tsc --noEmit',
        lint: 'eslint src/',
        test: 'vitest run --passWithNoTests',
        'test:watch': 'vitest',
      },
      dependencies: depEntries,
      devDependencies: {
        '@types/node': '^20.10.0',
        tsup: '^8.0.0',
        typescript: '^5.3.0',
        vitest: '^3.0.0',
      },
      keywords: ['pocket', name, 'database', 'local-first', category],
    },
    null,
    2,
  );
}

function generateTsConfig() {
  return JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: { outDir: './dist', rootDir: './src' },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.test.tsx'],
    },
    null,
    2,
  );
}

function generateTsupConfig() {
  return `import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
`;
}

function generateIndexTs(name) {
  const className = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  return `/**
 * @module @pocket/${name}
 * @description ${className} package for Pocket local-first database.
 *
 * @example
 * \`\`\`typescript
 * import { create${className} } from '@pocket/${name}';
 *
 * const instance = create${className}();
 * \`\`\`
 */

export { ${className}, create${className} } from './${name}.js';
export type { ${className}Config } from './types.js';
`;
}

function generateTypesTs(name) {
  const className = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  return `/**
 * Configuration for ${className}.
 */
export interface ${className}Config {
  /** Enable debug logging. */
  readonly debug?: boolean;
}
`;
}

function generateMainTs(name) {
  const className = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  return `import type { ${className}Config } from './types.js';

/**
 * ${className} provides functionality for the @pocket/${name} package.
 */
export class ${className} {
  private readonly config: Required<${className}Config>;

  constructor(config: ${className}Config = {}) {
    this.config = {
      debug: config.debug ?? false,
    };
  }

  /** Destroy and release resources. */
  destroy(): void {
    // Cleanup logic here
  }
}

/** Factory function to create a new ${className} instance. */
export function create${className}(config?: ${className}Config): ${className} {
  return new ${className}(config);
}
`;
}

function generateTestTs(name) {
  const className = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

  return `import { describe, it, expect, afterEach } from 'vitest';
import { create${className} } from '../${name}.js';

describe('${className}', () => {
  let instance: ReturnType<typeof create${className}>;

  afterEach(() => {
    instance?.destroy();
  });

  it('should create an instance via factory function', () => {
    instance = create${className}();
    expect(instance).toBeDefined();
  });

  it('should accept configuration', () => {
    instance = create${className}({ debug: true });
    expect(instance).toBeDefined();
  });

  it('should destroy without error', () => {
    instance = create${className}();
    expect(() => instance.destroy()).not.toThrow();
  });
});
`;
}

// --- Main ---
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/create-package.mjs <name> [options]

Options:
  --description "..."   Package description
  --category <cat>      Category: ${CATEGORIES.join(', ')} (default: extension)
  --deps <pkg1,pkg2>    Additional dependencies (comma-separated)
  --help                Show this help

Example:
  node scripts/create-package.mjs my-feature --description "My feature" --category extension
`);
  process.exit(0);
}

const opts = parseArgs(args);
validateArgs(opts);

const pkgDir = join('packages', opts.name);

if (existsSync(pkgDir)) {
  console.error(`Error: Package directory already exists: ${pkgDir}`);
  process.exit(1);
}

console.log(`Creating @pocket/${opts.name} (${opts.category})...`);

// Create directories
mkdirSync(join(pkgDir, 'src', '__tests__'), { recursive: true });

// Write files
const files = [
  [join(pkgDir, 'package.json'), generatePackageJson(opts.name, opts.description, opts.category, opts.deps)],
  [join(pkgDir, 'tsconfig.json'), generateTsConfig()],
  [join(pkgDir, 'tsup.config.ts'), generateTsupConfig()],
  [join(pkgDir, 'src', 'index.ts'), generateIndexTs(opts.name)],
  [join(pkgDir, 'src', 'types.ts'), generateTypesTs(opts.name)],
  [join(pkgDir, 'src', `${opts.name}.ts`), generateMainTs(opts.name)],
  [join(pkgDir, 'src', '__tests__', `${opts.name}.test.ts`), generateTestTs(opts.name)],
];

for (const [path, content] of files) {
  writeFileSync(path, content, 'utf-8');
  console.log(`  ✓ ${path}`);
}

console.log(`
✅ Package @pocket/${opts.name} created!

Next steps:
  1. pnpm install              # Update workspace
  2. npx turbo run build --filter=@pocket/${opts.name}  # Build
  3. npx vitest run --project unit packages/${opts.name}/  # Test
`);
