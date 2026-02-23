import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    benchmark: {
      include: ['src/suites/**/*.bench.ts'],
    },
  },
});
