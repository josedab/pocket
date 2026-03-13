import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    exclude: [
      '**/node_modules/**',
      // auth-manager.test.ts requires NODE_OPTIONS="--max-old-space-size=8192"
      // due to @pocket/core source transformation overhead. Run from root:
      //   npx vitest run --project unit packages/auth/src/__tests__/auth-manager.test.ts
      '**/auth-manager.test.ts',
    ],
  },
});
