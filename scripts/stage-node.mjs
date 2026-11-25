/**
 * Node.js livré avec l'application, pour que le serveur MCP marche sans rien
 * installer (l'exécutable d'Electron ne convient pas : il écrit sur stdout au
 * démarrage). Copie du Node qui construit l'application ; sur une autre
 * plateforme que la sienne, rien n'est livré et les assistants utilisent le
 * Node de l'utilisateur.
 */
import fs from 'node:fs';
import path from 'node:path';

export const STAGED_NODE = path.resolve('.native', 'node');

export function stageNode(platform, arch) {
  fs.rmSync(STAGED_NODE, { recursive: true, force: true });
  fs.mkdirSync(STAGED_NODE, { recursive: true });
  // Licence de Node, exigée avec le binaire ; le dossier n'est jamais vide.
  const installation = path.dirname(process.execPath);
  const license = [
    path.join(installation, 'LICENSE'),
    path.join(installation, '..', 'LICENSE'),
  ].find((file) => fs.existsSync(file));
  fs.writeFileSync(
    path.join(STAGED_NODE, 'LICENSE'),
    license
      ? fs.readFileSync(license)
      : 'Node.js : https://github.com/nodejs/node/blob/main/LICENSE\n',
  );
  if (platform !== process.platform || arch !== process.arch) return;
  const name = platform === 'win32' ? 'node.exe' : 'node';
  fs.copyFileSync(process.execPath, path.join(STAGED_NODE, name));
  fs.writeFileSync(path.join(STAGED_NODE, 'version'), process.version);
}
