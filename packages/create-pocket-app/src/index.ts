/**
 * create-pocket-app
 *
 * Create a new Pocket app with one command.
 *
 * Usage:
 *   npx create-pocket-app my-app
 *   npx create-pocket-app my-app --template react-todo
 *   npx create-pocket-app my-app --framework vue
 *
 * @module create-pocket-app
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * CLI version
 */
const VERSION = '0.1.0';

/**
 * Available templates
 */
const TEMPLATES: Record<string, TemplateConfig> = {
  'react-basic': {
    name: 'React Basic',
    description: 'Empty React starter with Pocket',
    framework: 'react',
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      '@pocket/core': 'latest',
      '@pocket/react': 'latest',
    },
    devDependencies: {
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0',
      typescript: '^5.3.0',
      vite: '^5.0.0',
      '@vitejs/plugin-react': '^4.2.0',
    },
  },
  'react-todo': {
    name: 'React Todo App',
    description: 'Complete todo app with React and Pocket',
    framework: 'react',
    dependencies: {
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      '@pocket/core': 'latest',
      '@pocket/react': 'latest',
    },
    devDependencies: {
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0',
      typescript: '^5.3.0',
      vite: '^5.0.0',
      '@vitejs/plugin-react': '^4.2.0',
    },
  },
  'vue-basic': {
    name: 'Vue Basic',
    description: 'Empty Vue starter with Pocket',
    framework: 'vue',
    dependencies: {
      vue: '^3.4.0',
      '@pocket/core': 'latest',
      '@pocket/vue': 'latest',
    },
    devDependencies: {
      typescript: '^5.3.0',
      vite: '^5.0.0',
      '@vitejs/plugin-vue': '^4.5.0',
      'vue-tsc': '^1.8.0',
    },
  },
  'svelte-basic': {
    name: 'Svelte Basic',
    description: 'Empty Svelte starter with Pocket',
    framework: 'svelte',
    dependencies: {
      '@pocket/core': 'latest',
      '@pocket/svelte': 'latest',
    },
    devDependencies: {
      svelte: '^4.2.0',
      typescript: '^5.3.0',
      vite: '^5.0.0',
      '@sveltejs/vite-plugin-svelte': '^3.0.0',
    },
  },
};

/**
 * Template configuration
 */
interface TemplateConfig {
  name: string;
  description: string;
  framework: 'react' | 'vue' | 'svelte' | 'solid';
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

/**
 * CLI options
 */
interface CLIOptions {
  projectName: string;
  template: string;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  skipInstall: boolean;
  skipGit: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): Partial<CLIOptions> & { help?: boolean; version?: boolean } {
  const result: Partial<CLIOptions> & { help?: boolean; version?: boolean } = {};
  let projectName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--template' || arg === '-t') {
      result.template = args[++i];
    } else if (arg === '--pm') {
      result.packageManager = args[++i] as CLIOptions['packageManager'];
    } else if (arg === '--skip-install') {
      result.skipInstall = true;
    } else if (arg === '--skip-git') {
      result.skipGit = true;
    } else if (!arg.startsWith('-') && !projectName) {
      projectName = arg;
    }
  }

  if (projectName) {
    result.projectName = projectName;
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
create-pocket-app - Create a new Pocket app

Usage:
  npx create-pocket-app <project-name> [options]

Options:
  -t, --template <name>   Template to use (default: react-basic)
  --pm <manager>          Package manager: npm, pnpm, yarn (default: auto-detect)
  --skip-install          Skip installing dependencies
  --skip-git              Skip initializing git repository
  -h, --help              Show this help message
  -v, --version           Show version

Templates:
${Object.entries(TEMPLATES)
  .map(([key, val]) => `  ${key.padEnd(16)} ${val.description}`)
  .join('\n')}

Examples:
  npx create-pocket-app my-app
  npx create-pocket-app my-app --template react-todo
  npx create-pocket-app my-app --template vue-basic --pm pnpm
`);
}

/**
 * Print version
 */
function printVersion(): void {
  console.log(`create-pocket-app v${VERSION}`);
}

/**
 * Detect package manager
 */
function detectPackageManager(): CLIOptions['packageManager'] {
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (userAgent.includes('pnpm')) return 'pnpm';
  if (userAgent.includes('yarn')) return 'yarn';
  return 'npm';
}

/**
 * Create package.json content
 */
function createPackageJson(name: string, template: TemplateConfig): Record<string, unknown> {
  return {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
    },
    dependencies: template.dependencies,
    devDependencies: template.devDependencies,
  };
}

/**
 * Create basic project files based on framework
 */
function createProjectFiles(projectDir: string, template: TemplateConfig): void {
  const framework = template.framework;

  // Create vite.config.ts
  const viteConfigs: Record<string, string> = {
    react: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
    vue: `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
`,
    svelte: `import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
});
`,
    solid: `import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
});
`,
  };

  fs.writeFileSync(
    path.join(projectDir, 'vite.config.ts'),
    viteConfigs[framework] ?? viteConfigs.react!
  );

  // Create tsconfig.json
  fs.writeFileSync(
    path.join(projectDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          useDefineForClassFields: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: framework === 'react' ? 'react-jsx' : undefined,
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
        },
        include: ['src'],
      },
      null,
      2
    )
  );

  // Create index.html
  fs.writeFileSync(
    path.join(projectDir, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pocket App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.${framework === 'svelte' ? 'ts' : 'tsx'}"></script>
  </body>
</html>
`
  );

  // Create src directory
  const srcDir = path.join(projectDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  // Create main entry point based on framework
  if (framework === 'react') {
    fs.writeFileSync(
      path.join(srcDir, 'main.tsx'),
      `import React from 'react';
import ReactDOM from 'react-dom/client';
import { PocketProvider } from '@pocket/react';
import { Database } from '@pocket/core';
import App from './App';
import './index.css';

const db = Database.create({ name: 'my-pocket-app' });

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <PocketProvider database={db}>
      <App />
    </PocketProvider>
  </React.StrictMode>
);
`
    );

    fs.writeFileSync(
      path.join(srcDir, 'App.tsx'),
      `import { useLiveQuery } from '@pocket/react';

interface Item {
  _id: string;
  title: string;
  createdAt: Date;
}

function App() {
  const { data: items, isLoading } = useLiveQuery<Item>('items');

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <h1>Pocket App</h1>
      <p>Welcome to your new Pocket-powered app!</p>
      <p>Items in database: {items.length}</p>
    </div>
  );
}

export default App;
`
    );
  } else if (framework === 'vue') {
    fs.writeFileSync(
      path.join(srcDir, 'main.ts'),
      `import { createApp } from 'vue';
import { createPocketPlugin } from '@pocket/vue';
import { Database } from '@pocket/core';
import App from './App.vue';
import './style.css';

const db = Database.create({ name: 'my-pocket-app' });

const app = createApp(App);
app.use(createPocketPlugin({ database: db }));
app.mount('#app');
`
    );

    fs.writeFileSync(
      path.join(srcDir, 'App.vue'),
      `<script setup lang="ts">
import { useLiveQuery } from '@pocket/vue';

interface Item {
  _id: string;
  title: string;
}

const { data: items, isLoading } = useLiveQuery<Item>('items');
</script>

<template>
  <div v-if="isLoading">Loading...</div>
  <div v-else>
    <h1>Pocket App</h1>
    <p>Welcome to your new Pocket-powered app!</p>
    <p>Items in database: {{ items.length }}</p>
  </div>
</template>
`
    );
  }

  // Create CSS file
  fs.writeFileSync(
    path.join(srcDir, framework === 'vue' ? 'style.css' : 'index.css'),
    `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

#app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}
`
  );

  // Create pocket.config.ts
  fs.writeFileSync(
    path.join(projectDir, 'pocket.config.ts'),
    `import { defineConfig } from '@pocket/cli';

export default defineConfig({
  database: {
    name: 'my-pocket-app',
    storage: 'indexeddb',
  },
  collections: {
    items: {
      schema: {
        properties: {
          title: { type: 'string', required: true },
          createdAt: { type: 'date' },
        },
      },
    },
  },
});
`
  );

  // Create .gitignore
  fs.writeFileSync(
    path.join(projectDir, '.gitignore'),
    `# Dependencies
node_modules/

# Build output
dist/

# IDE
.vscode/
.idea/

# Environment
.env
.env.local

# Logs
*.log

# Pocket
.pocket/
`
  );
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    printVersion();
    process.exit(0);
  }

  if (!args.projectName) {
    console.error('Error: Project name is required');
    console.error('Usage: npx create-pocket-app <project-name>');
    process.exit(1);
  }

  const projectName = args.projectName;
  const templateName = args.template ?? 'react-basic';
  const template = TEMPLATES[templateName];

  if (!template) {
    console.error(`Error: Unknown template "${templateName}"`);
    console.error(`Available templates: ${Object.keys(TEMPLATES).join(', ')}`);
    process.exit(1);
  }

  const projectDir = path.resolve(process.cwd(), projectName);
  const packageManager = args.packageManager ?? detectPackageManager();

  // Check if directory exists
  if (fs.existsSync(projectDir)) {
    console.error(`Error: Directory "${projectName}" already exists`);
    process.exit(1);
  }

  console.log(`
Creating a new Pocket app in ${projectDir}

Using template: ${template.name}
Package manager: ${packageManager}
`);

  // Create project directory
  fs.mkdirSync(projectDir, { recursive: true });

  // Create package.json
  const packageJson = createPackageJson(projectName, template);
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  console.log('  ✓ Created package.json');

  // Create project files
  createProjectFiles(projectDir, template);
  console.log('  ✓ Created project files');

  // Initialize git
  if (!args.skipGit) {
    try {
      execSync('git init', { cwd: projectDir, stdio: 'ignore' });
      console.log('  ✓ Initialized git repository');
    } catch {
      console.log('  ⚠ Could not initialize git repository');
    }
  }

  // Install dependencies
  if (!args.skipInstall) {
    console.log('\nInstalling dependencies...\n');
    try {
      const installCmd =
        packageManager === 'yarn'
          ? 'yarn'
          : packageManager === 'pnpm'
            ? 'pnpm install'
            : 'npm install';
      execSync(installCmd, { cwd: projectDir, stdio: 'inherit' });
    } catch {
      console.log('\n⚠ Could not install dependencies. Please run install manually.');
    }
  }

  console.log(`
✓ Created ${projectName}

Next steps:
  cd ${projectName}
  ${packageManager === 'yarn' ? 'yarn dev' : `${packageManager} run dev`}

Happy building! 🚀
`);
}

// Run CLI
main().catch((error: unknown) => {
  console.error('Error:', error);
  process.exit(1);
});
