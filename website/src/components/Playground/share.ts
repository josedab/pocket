/**
 * Shareable Playground URLs
 *
 * Utilities for creating shareable playground URLs via StackBlitz.
 *
 * @module Playground/share
 */

import type { PlaygroundExample } from './index';

/**
 * Default package.json for Pocket examples
 */
const defaultPackageJson = {
  name: 'pocket-playground',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'tsc && vite build',
    preview: 'vite preview',
  },
  dependencies: {
    '@pocket/core': 'latest',
    '@pocket/react': 'latest',
    react: '^18.2.0',
    'react-dom': '^18.2.0',
  },
  devDependencies: {
    '@types/react': '^18.2.0',
    '@types/react-dom': '^18.2.0',
    '@vitejs/plugin-react': '^4.2.0',
    typescript: '^5.3.0',
    vite: '^5.0.0',
  },
};

/**
 * Default vite.config.ts
 */
const defaultViteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

/**
 * Default tsconfig.json
 */
const defaultTsConfig = JSON.stringify(
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
      jsx: 'react-jsx',
      strict: true,
    },
    include: ['src'],
  },
  null,
  2
);

/**
 * Default index.html
 */
const defaultIndexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pocket Playground</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

/**
 * Generate a StackBlitz URL for an example
 */
export function generateStackBlitzUrl(example: PlaygroundExample): string {
  const files: Record<string, string> = {
    'package.json': JSON.stringify(defaultPackageJson, null, 2),
    'vite.config.ts': defaultViteConfig,
    'tsconfig.json': defaultTsConfig,
    'index.html': defaultIndexHtml,
    ...example.files,
  };

  // Build URL parameters for StackBlitz
  const params = new URLSearchParams();
  params.set('template', 'node');
  params.set('title', example.name);
  params.set('description', example.description);

  // Encode files
  Object.entries(files).forEach(([filename, content]) => {
    params.set(`file[${filename}]`, content);
  });

  return `https://stackblitz.com/edit?${params.toString()}`;
}

/**
 * Open an example in a new StackBlitz tab
 */
export function openInStackBlitz(example: PlaygroundExample): void {
  const url = generateStackBlitzUrl(example);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Generate a shareable URL with compressed code
 * Uses URL-safe base64 encoding
 */
export function generateShareableUrl(example: PlaygroundExample): string {
  const data = JSON.stringify({
    name: example.name,
    description: example.description,
    files: example.files,
  });

  // Compress and encode
  const encoded = btoa(encodeURIComponent(data));
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return `${baseUrl}/docs/playground?example=${encoded}`;
}

/**
 * Parse a shareable URL and extract the example
 */
export function parseShareableUrl(url: string): PlaygroundExample | null {
  try {
    const urlObj = new URL(url);
    const encoded = urlObj.searchParams.get('example');

    if (!encoded) return null;

    const data = JSON.parse(decodeURIComponent(atob(encoded)));

    return {
      name: data.name || 'Shared Example',
      description: data.description || 'A shared Pocket example',
      files: data.files || {},
    };
  } catch {
    return null;
  }
}

/**
 * Copy shareable URL to clipboard
 */
export async function copyShareableUrl(example: PlaygroundExample): Promise<boolean> {
  try {
    const url = generateShareableUrl(example);
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}
