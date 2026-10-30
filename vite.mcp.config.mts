import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
};

// Serveur MCP autonome, exécuté par Node.js (pas par Electron) : un seul
// fichier, livré hors de l'archive asar (voir extraResource dans forge.config).
export default defineConfig({
  define: {
    NODAL_VERSION: JSON.stringify(version),
  },
  // Points d'entrée Node.js des dépendances (comme la cible `main` de Forge).
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    target: 'node22',
    lib: {
      entry: 'src/mcp/index.ts',
      fileName: () => 'nodal-mcp.cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      // Modules de Node (`node:sqlite` : voir vite.main.config.mts). Explicites
      // pour que le build fonctionne aussi hors de Forge.
      external: [
        'node:sqlite',
        ...builtinModules.flatMap((name) => [name, `node:${name}`]),
      ],
      output: { inlineDynamicImports: true },
    },
  },
});
