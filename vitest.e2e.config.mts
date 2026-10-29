import { defineConfig } from 'vitest/config';

/**
 * Tests de bout en bout dans Electron (Playwright). Prérequis : le build
 * (.vite/) doit exister — `npm run test:e2e` le construit d'abord.
 */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
