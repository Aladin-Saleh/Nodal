import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      fileName: () => 'main.cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      // `node:sqlite` n'existe qu'avec le préfixe `node:` et n'apparaît pas dans
      // `builtinModules` sous Node 22 : Forge ne l'externalise donc pas tout
      // seul. Il est fourni par le runtime Node embarqué dans Electron.
      external: ['node:sqlite'],
    },
  },
});
