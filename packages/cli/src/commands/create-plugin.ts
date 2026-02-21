/**
 * @pocket/cli - Create Plugin Command
 *
 * Scaffolds a new Pocket plugin project with full directory structure.
 *
 * @module @pocket/cli/commands
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Options for the create-plugin command
 */
export interface CreatePluginOptions {
  /** Plugin name (e.g. "my-cache") */
  name: string;
  /** Output directory (defaults to cwd) */
  outputDir?: string;
}

/**
 * Validate a plugin name
 */
function validatePluginName(name: string): string | null {
  if (!name) {
    return 'Plugin name is required';
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return 'Plugin name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens';
  }
  return null;
}

/**
 * Convert kebab-case to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

/**
 * Generate all scaffold files for a plugin
 */
function generateFiles(name: string): { path: string; content: string }[] {
  const pkgName = `pocket-plugin-${name}`;
  const pascalName = toPascalCase(name);
  const files: { path: string; content: string }[] = [];

  // package.json
  files.push({
    path: 'package.json',
    content: JSON.stringify(
      {
        name: pkgName,
        version: '0.1.0',
        description: `Pocket plugin: ${name}`,
        type: 'module',
        main: './dist/index.cjs',
        module: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
            require: './dist/index.cjs',
          },
        },
        files: ['dist'],
        scripts: {
          build: 'tsup',
          test: 'vitest run',
          dev: 'tsup --watch',
          typecheck: 'tsc --noEmit',
        },
        peerDependencies: {
          '@pocket/core': '^0.1.0',
        },
        devDependencies: {
          '@pocket/core': '^0.1.0',
          tsup: '^8.0.0',
          typescript: '^5.3.0',
          vitest: '^3.0.0',
        },
        license: 'MIT',
      },
      null,
      2,
    ),
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
      2,
    ),
  });

  // tsup.config.ts
  files.push({
    path: 'tsup.config.ts',
    content: `import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
`,
  });

  // src/index.ts
  files.push({
    path: 'src/index.ts',
    content: `export { create${pascalName}Plugin } from './plugin.js';
export type { ${pascalName}PluginOptions } from './types.js';
`,
  });

  // src/types.ts
  files.push({
    path: 'src/types.ts',
    content: `/**
 * Options for the ${name} plugin
 */
export interface ${pascalName}PluginOptions {
  /** Whether the plugin is enabled */
  enabled?: boolean;
}
`,
  });

  // src/plugin.ts
  files.push({
    path: 'src/plugin.ts',
    content: `import type { PluginDefinition } from '@pocket/core';
import type { ${pascalName}PluginOptions } from './types.js';

/**
 * Create the ${name} plugin
 */
export function create${pascalName}Plugin(options?: ${pascalName}PluginOptions): PluginDefinition {
  const _enabled = options?.enabled ?? true;

  return {
    name: '${pkgName}',
    version: '0.1.0',

    onInit() {
      if (!_enabled) return;
      // Plugin initialization logic
    },

    onDestroy() {
      // Cleanup logic
    },
  };
}
`,
  });

  // src/__tests__/plugin.test.ts
  files.push({
    path: 'src/__tests__/plugin.test.ts',
    content: `import { describe, it, expect } from 'vitest';
import { create${pascalName}Plugin } from '../plugin.js';

describe('${pkgName}', () => {
  it('should create a plugin with default options', () => {
    const plugin = create${pascalName}Plugin();
    expect(plugin.name).toBe('${pkgName}');
    expect(plugin.version).toBe('0.1.0');
  });

  it('should accept custom options', () => {
    const plugin = create${pascalName}Plugin({ enabled: false });
    expect(plugin.name).toBe('${pkgName}');
  });

  it('should have lifecycle hooks', () => {
    const plugin = create${pascalName}Plugin();
    expect(plugin.onInit).toBeDefined();
    expect(plugin.onDestroy).toBeDefined();
  });
});
`,
  });

  // README.md
  files.push({
    path: 'README.md',
    content: `# ${pkgName}

Pocket plugin: ${name}

## Installation

\`\`\`bash
npm install ${pkgName}
\`\`\`

## Usage

\`\`\`typescript
import { create${pascalName}Plugin } from '${pkgName}';

const plugin = create${pascalName}Plugin({
  enabled: true,
});
\`\`\`

## API

### \`create${pascalName}Plugin(options?)\`

Creates a new instance of the ${name} plugin.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| \`enabled\` | \`boolean\` | \`true\` | Whether the plugin is enabled |

## License

MIT
`,
  });

  // LICENSE
  const year = new Date().getFullYear();
  files.push({
    path: 'LICENSE',
    content: `MIT License

Copyright (c) ${year} Pocket Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  });

  return files;
}

/**
 * Scaffold a new Pocket plugin project
 *
 * @param name - Plugin name (kebab-case)
 * @param outputDir - Parent directory for the plugin folder (defaults to cwd)
 * @returns List of created file paths
 */
export async function createPluginCommand(
  name: string,
  outputDir?: string,
): Promise<{ files: string[] }> {
  const validationError = validatePluginName(name);
  if (validationError) {
    throw new Error(validationError);
  }

  const baseDir = outputDir ?? process.cwd();
  const pluginDir = path.join(baseDir, `pocket-plugin-${name}`);

  if (fs.existsSync(pluginDir)) {
    throw new Error(`Directory already exists: pocket-plugin-${name}`);
  }

  const files = generateFiles(name);
  const createdFiles: string[] = [];

  for (const file of files) {
    const filePath = path.join(pluginDir, file.path);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, file.content);
    createdFiles.push(file.path);
  }

  console.log(`\n✓ Created plugin project: pocket-plugin-${name}`);
  console.log(`  ${createdFiles.length} files generated in ${pluginDir}\n`);

  return { files: createdFiles };
}
