import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // L'entrée s'appelle index.ts : nom de sortie explicite, attendu par
      // src/main/window.ts.
      output: { entryFileNames: 'preload.cjs' },
    },
  },
});
