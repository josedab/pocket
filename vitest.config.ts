import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.test.tsx',
        'packages/*/src/__tests__/**',
        'packages/*/src/index.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/src/**/*.integration.test.ts'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        test: {
          name: 'react',
          include: ['packages/react/src/**/*.test.tsx'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./test/setup-react.ts'],
        },
      },
    ],
  },
});
