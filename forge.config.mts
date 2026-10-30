import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Nodal',
    executableName: 'nodal',
    // Icône de l'exécutable (extension ajoutée selon la plateforme).
    icon: 'assets/icon',
    asar: true,
    appCopyright: 'Aladin',
    // Serveur MCP exécuté par Node.js : il doit rester hors de l'archive asar.
    extraResource: ['.vite/build/nodal-mcp.cjs'],
    win32metadata: {
      CompanyName: 'Aladin',
      ProductName: 'Nodal',
      FileDescription: 'Nodal — base de connaissances techniques',
    },
  },
  rebuildConfig: {},
  makers: [
    // Installateur Windows (§3.2).
    new MakerSquirrel({
      name: 'Nodal',
      setupExe: 'NodalSetup.exe',
      setupIcon: 'assets/icon.ico',
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
