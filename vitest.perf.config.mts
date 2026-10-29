import { defineConfig } from 'vitest/config';

/** Mesures de performance (§9), séparées des tests unitaires. */
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
