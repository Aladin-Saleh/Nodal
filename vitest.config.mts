import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Les tests du renderer déclarent `// @vitest-environment jsdom`.
    restoreMocks: true,
  },
});
