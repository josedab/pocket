import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/cloudflare.ts',
    'src/deno.ts',
    'src/vercel.ts',
    'src/bun.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: true,
  treeshake: true,
  minify: false,
  external: ['@pocket/core', 'rxjs'],
});
