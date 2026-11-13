/**
 * Copie allégée de node-pty (terminal intégré) pour l'application installée :
 * code JavaScript et binaires de la plateforme, sans sources, tests ni
 * symboles de débogage (.pdb, ~25 Mo). Le module est chargé hors de l'archive
 * asar (binaires natifs, worker), depuis `resources/node-pty`.
 *
 *   node scripts/stage-node-pty.mjs [plateforme] [architecture]
 */
import fs from 'node:fs';
import path from 'node:path';

export const STAGED_NODE_PTY = path.resolve('.native', 'node-pty');

/** Fichiers inutiles à l'exécution : symboles, cartes de sources, tests. */
const keep = (file) => !/\.(pdb|map)$/.test(file) && !file.endsWith('.test.js');

export function stageNodePty(platform = process.platform, arch = process.arch) {
  const source = path.resolve('node_modules', 'node-pty');
  fs.rmSync(STAGED_NODE_PTY, { recursive: true, force: true });
  const copy = (relative) =>
    fs.cpSync(
      path.join(source, relative),
      path.join(STAGED_NODE_PTY, relative),
      {
        recursive: true,
        filter: (file) => keep(file),
      },
    );
  copy('package.json');
  copy('LICENSE');
  copy('lib');
  copy(path.join('prebuilds', `${platform}-${arch}`));
  return STAGED_NODE_PTY;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll('\\', '/')}`) {
  console.log(stageNodePty(process.argv[2], process.argv[3]));
}
