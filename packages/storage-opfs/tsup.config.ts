import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    external: ['@pocket/core', 'rxjs'],
  },
  {
    entry: ['src/worker.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    treeshake: true,
    minify: false,
    outExtension: () => ({ js: '.js' }),
  },
]);
