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
    'expo-sqlite',
    'expo-file-system',
    'react',
    'react-native',
    '@pocket/core',
    '@pocket/react',
    'rxjs',
  ],
});
