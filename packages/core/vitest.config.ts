import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@pocket/storage-memory': path.resolve(__dirname, '../storage-memory/src/index.ts'),
      '@pocket/core': path.resolve(__dirname, './src/index.ts'),
    },
  },
});
