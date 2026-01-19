import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
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
]);
