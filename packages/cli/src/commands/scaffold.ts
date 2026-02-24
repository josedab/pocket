/**
 * Project Scaffolder — creates new Pocket projects from templates.
 *
 * Generates a complete project structure with TypeScript config,
 * database setup, collection definitions, and optional framework
 * integration (React, Next.js, etc.).
 */

/** Available project templates. */
export type ProjectTemplate = 'basic' | 'react' | 'nextjs' | 'node-api' | 'react-native';

/** Scaffolding options. */
export interface ScaffoldOptions {
  readonly name: string;
  readonly template: ProjectTemplate;
  readonly directory?: string;
  readonly collections?: readonly string[];
  readonly withSync?: boolean;
  readonly withAuth?: boolean;
  readonly packageManager?: 'npm' | 'pnpm' | 'yarn';
}

/** A generated file from the scaffolder. */
export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

/** Scaffolding result. */
export interface ScaffoldResult {
  readonly success: boolean;
  readonly files: readonly GeneratedFile[];
  readonly commands: readonly string[];
  readonly error?: string;
}

/** Generate a package.json for the project. */
function generatePackageJson(options: ScaffoldOptions): string {
  const deps: Record<string, string> = {
    pocket: '^0.1.0',
  };

  if (options.withSync) {
    deps['@pocket/sync'] = '^0.1.0';
    deps['@pocket/server'] = '^0.1.0';
  }
  if (options.withAuth) {
    deps['@pocket/auth'] = '^0.1.0';
  }
  if (options.template === 'react' || options.template === 'nextjs') {
    deps['@pocket/react'] = '^0.1.0';
    deps.react = '^18.0.0';
    deps['react-dom'] = '^18.0.0';
  }

  return JSON.stringify(
    {
      name: options.name,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: options.template === 'nextjs' ? 'next dev' : 'vite',
        build: options.template === 'nextjs' ? 'next build' : 'vite build',
        start: options.template === 'node-api' ? 'node dist/index.js' : 'vite preview',
      },
      dependencies: deps,
      devDependencies: {
        typescript: '^5.3.0',
      },
    },
    null,
    2
  );
}

/** Generate the database setup file. */
function generateDatabaseSetup(options: ScaffoldOptions): string {
  const lines: string[] = ["import { createDatabase, createIndexedDBStorage } from 'pocket';", ''];

  if (options.collections?.length) {
    for (const col of options.collections) {
      lines.push(`export interface ${pascalCase(col)} {`);
      lines.push('  _id: string;');
      lines.push('  // Add your fields here');
      lines.push('}');
      lines.push('');
    }
  }

  lines.push('export async function initDatabase() {');
  lines.push('  const db = await createDatabase({');
  lines.push(`    name: '${options.name}',`);
  lines.push('    storage: createIndexedDBStorage(),');
  lines.push('  });');
  lines.push('');

  if (options.collections?.length) {
    for (const col of options.collections) {
      lines.push(`  const ${col} = db.collection<${pascalCase(col)}>('${col}');`);
    }
  }

  lines.push('');
  lines.push('  return db;');
  lines.push('}');

  return lines.join('\n');
}

/** Generate a pocket.config.ts file. */
function generateConfig(options: ScaffoldOptions): string {
  const lines: string[] = [
    "import { defineConfig } from '@pocket/cli';",
    '',
    'export default defineConfig({',
    `  database: { name: '${options.name}' },`,
    '  collections: {',
  ];

  for (const col of options.collections ?? []) {
    lines.push(`    ${col}: {`);
    lines.push('      schema: {');
    lines.push('        properties: {},');
    lines.push('      },');
    lines.push('    },');
  }

  lines.push('  },');
  lines.push('});');

  return lines.join('\n');
}

function pascalCase(str: string): string {
  return str.replace(/(^|[-_\s])(\w)/g, (_, _sep, c: string) => c.toUpperCase());
}

/**
 * Scaffold a new Pocket project.
 */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  try {
    const files: GeneratedFile[] = [];
    const dir = options.directory ?? options.name;

    files.push({
      path: `${dir}/package.json`,
      content: generatePackageJson(options),
    });

    files.push({
      path: `${dir}/src/database.ts`,
      content: generateDatabaseSetup(options),
    });

    files.push({
      path: `${dir}/pocket.config.ts`,
      content: generateConfig(options),
    });

    files.push({
      path: `${dir}/tsconfig.json`,
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            outDir: './dist',
            rootDir: './src',
          },
          include: ['src'],
        },
        null,
        2
      ),
    });

    if (options.template === 'react') {
      files.push({
        path: `${dir}/src/App.tsx`,
        content: [
          "import { PocketProvider } from '@pocket/react';",
          "import { initDatabase } from './database';",
          '',
          'const db = await initDatabase();',
          '',
          'export function App() {',
          '  return (',
          '    <PocketProvider database={db}>',
          '      <div>Hello Pocket!</div>',
          '    </PocketProvider>',
          '  );',
          '}',
        ].join('\n'),
      });
    }

    const pm = options.packageManager ?? 'npm';
    const commands = [`cd ${dir}`, `${pm} install`, `${pm} run dev`];

    return { success: true, files, commands };
  } catch (err) {
    return {
      success: false,
      files: [],
      commands: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generate a typed collection file from a schema.
 */
export function generateCollectionCode(
  collectionName: string,
  fields: readonly { name: string; type: string; required?: boolean }[]
): string {
  const iface = pascalCase(collectionName);
  const lines: string[] = [
    `// Auto-generated by pocket generate`,
    `// Collection: ${collectionName}`,
    '',
    `export interface ${iface} {`,
    '  _id: string;',
  ];

  for (const field of fields) {
    const optional = field.required ? '' : '?';
    lines.push(`  ${field.name}${optional}: ${field.type};`);
  }

  lines.push('}');
  lines.push('');
  lines.push(`export const ${collectionName}CollectionName = '${collectionName}' as const;`);

  return lines.join('\n');
}
