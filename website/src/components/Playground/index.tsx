/**
 * Interactive Playground Component
 *
 * Embeds a StackBlitz IDE with pre-configured Pocket examples.
 * Users can experiment with Pocket in the browser without local setup.
 *
 * @module Playground
 */

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import styles from './styles.module.css';

/**
 * Example configuration for the playground
 */
export interface PlaygroundExample {
  /** Display name for the example */
  name: string;
  /** Short description */
  description: string;
  /** Project files */
  files: Record<string, string>;
  /** Main file to open */
  openFile?: string;
  /** Terminal command to run */
  startScript?: string;
}

/**
 * Props for the Playground component
 */
export interface PlaygroundProps {
  /** The example to load */
  example: PlaygroundExample;
  /** Height of the playground */
  height?: string;
  /** Whether to show the file explorer */
  showFileExplorer?: boolean;
  /** Whether to show the terminal */
  showTerminal?: boolean;
  /** Theme for the editor */
  theme?: 'light' | 'dark';
}

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
 * Interactive Playground component using StackBlitz WebContainer
 */
export function Playground({
  example,
  height = '600px',
  showFileExplorer = true,
  showTerminal = true,
  theme = 'dark',
}: PlaygroundProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStackBlitz = async () => {
      if (!containerRef.current) return;

      try {
        // Dynamically import StackBlitz SDK
        const sdk = await import('@stackblitz/sdk');

        // Merge default files with example files
        const files: Record<string, string> = {
          'package.json': JSON.stringify(defaultPackageJson, null, 2),
          'vite.config.ts': defaultViteConfig,
          'tsconfig.json': defaultTsConfig,
          'index.html': defaultIndexHtml,
          ...example.files,
        };

        // Embed the project
        await sdk.default.embedProject(
          containerRef.current,
          {
            title: example.name,
            description: example.description,
            template: 'node',
            files,
          },
          {
            openFile: example.openFile ?? 'src/App.tsx',
            view: showTerminal ? 'default' : 'editor',
            hideExplorer: !showFileExplorer,
            theme,
            startScript: example.startScript ?? 'dev',
            height: '100%',
          }
        );

        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load playground');
        setIsLoading(false);
      }
    };

    loadStackBlitz();
  }, [example, showFileExplorer, showTerminal, theme]);

  return (
    <div className={styles.playgroundContainer} style={{ height }}>
      {isLoading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Loading playground...</span>
        </div>
      )}
      {error && (
        <div className={styles.error}>
          <span>Failed to load playground: {error}</span>
          <p>
            Try opening the example directly on{' '}
            <a href="https://stackblitz.com" target="_blank" rel="noopener noreferrer">
              StackBlitz
            </a>
          </p>
        </div>
      )}
      <div ref={containerRef} className={styles.embedContainer} />
    </div>
  );
}

/**
 * Playground with example selector
 */
export interface PlaygroundWithSelectorProps {
  /** Available examples */
  examples: PlaygroundExample[];
  /** Default example to show */
  defaultExample?: string;
  /** Height of the playground */
  height?: string;
}

export function PlaygroundWithSelector({
  examples,
  defaultExample,
  height = '650px',
}: PlaygroundWithSelectorProps): ReactNode {
  const [selectedExample, setSelectedExample] = useState(
    examples.find((e) => e.name === defaultExample) ?? examples[0]
  );

  if (!selectedExample) {
    return <div>No examples available</div>;
  }

  return (
    <div className={styles.playgroundWrapper}>
      <div className={styles.exampleSelector}>
        <label htmlFor="example-select">Choose an example:</label>
        <select
          id="example-select"
          value={selectedExample.name}
          onChange={(e) => {
            const example = examples.find((ex) => ex.name === e.target.value);
            if (example) setSelectedExample(example);
          }}
        >
          {examples.map((example) => (
            <option key={example.name} value={example.name}>
              {example.name}
            </option>
          ))}
        </select>
        <span className={styles.exampleDescription}>{selectedExample.description}</span>
      </div>
      <Playground example={selectedExample} height={height} />
    </div>
  );
}

export default Playground;
