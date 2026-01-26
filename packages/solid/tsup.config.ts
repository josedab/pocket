import * as esbuild from 'esbuild';
import { solidPlugin } from 'esbuild-plugin-solid';
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
  external: ['@pocket/core', 'solid-js', 'rxjs'],
  esbuildPlugins: [solidPlugin() as esbuild.Plugin],
});
