import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { stageNode } from './scripts/stage-node.mjs';
import { stageNodePty } from './scripts/stage-node-pty.mjs';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Nodal',
    executableName: 'nodal',
    // Icône de l'exécutable (extension ajoutée selon la plateforme).
    icon: 'assets/icon',
    asar: true,
    appCopyright: "© 2026 Aladin SALEH — Aladinvention's Software",
    // Serveur MCP, Node.js qui l'exécute, et node-pty (terminal : binaires
    // natifs, worker) : hors de l'archive asar.
    extraResource: [
      '.vite/build/nodal-mcp.cjs',
      '.native/node',
      '.native/node-pty',
    ],
    win32metadata: {
      CompanyName: "Aladinvention's Software",
      ProductName: 'Nodal',
      FileDescription: 'Nodal — base de connaissances techniques',
    },
  },
  // node-pty fournit des binaires N-API, valables pour Electron : pas de
  // recompilation (qui demanderait les outils de build C++).
  rebuildConfig: { onlyModules: [] },
  hooks: {
    // Node et copie allégée de node-pty pour la plateforme visée.
    prePackage: async (_config, platform, arch) => {
      stageNodePty(platform, arch);
      stageNode(platform, arch);
    },
  },
  makers: [
    // Installateur Windows (§3.2).
    new MakerSquirrel({
      name: 'Nodal',
      setupExe: 'NodalSetup.exe',
      setupIcon: 'assets/icon.ico',
      authors: 'Aladin SALEH',
      // Animation pendant l'installation : scripts/generate-installer-gif.mjs.
      loadingGif: 'assets/installer.gif',
    }),
    // Archive portable exécutable sans installation.
    new MakerZIP({}, ['win32', 'darwin', 'linux']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/mcp/index.ts',
          config: 'vite.mcp.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
