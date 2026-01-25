import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: [
    '@angular/core',
    '@pocket/core',
    '@pocket/storage-indexeddb',
    '@pocket/storage-opfs',
    '@pocket/storage-memory',
    'rxjs',
  ],
});
