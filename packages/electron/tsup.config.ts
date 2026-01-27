import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/main/index.ts', 'src/preload/index.ts', 'src/renderer/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['electron', '@pocket/core', '@pocket/storage-sqlite', 'rxjs'],
});
