import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/d1-adapter.ts', 'src/durable-objects-adapter.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['@pocket/core', 'rxjs'],
});
