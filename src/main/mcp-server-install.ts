/**
 * Copie du serveur MCP vers un chemin stable (profil de l'utilisateur).
 *
 * Installé, le serveur est livré dans `resources`, dont le chemin contient la
 * version de l'application (`…\Nodal\app-1.4.0\resources`) : chaque mise à
 * jour cassait la configuration des assistants. Au démarrage, Nodal recopie
 * donc son serveur vers un chemin qui ne change pas ; les assistants déjà
 * configurés utilisent ainsi toujours le serveur de la version installée.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MCP_SERVER_FILE_NAME = 'nodal-mcp.cjs';

/**
 * Copie `source` dans `targetDir` s'il est absent ou différent, et renvoie le
 * chemin à indiquer aux assistants. En cas d'échec (disque, droits), renvoie
 * `source` : le serveur reste utilisable depuis l'installation.
 */
export function installMcpServer(source: string, targetDir: string): string {
  const target = path.join(targetDir, MCP_SERVER_FILE_NAME);
  try {
    const content = fs.readFileSync(source);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(content)) {
      return target;
    }
    fs.mkdirSync(targetDir, { recursive: true });
    // Écriture puis renommage : un serveur qui démarre au même moment ne lit
    // jamais un fichier à moitié écrit.
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, target);
    return target;
  } catch (error) {
    console.error('[mcp] copie du serveur impossible', error);
    return source;
  }
}
