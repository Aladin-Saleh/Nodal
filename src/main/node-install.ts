/**
 * Node.js livré avec l'application (scripts/stage-node.mjs), recopié à un
 * chemin stable comme le serveur MCP (mcp-server-install.ts) : les assistants
 * le lancent sans que l'utilisateur ait à installer Node.
 */
import fs from 'node:fs';
import path from 'node:path';

const VERSION_FILE = 'version';

/** Chemin à indiquer aux assistants ; `node` si rien n'est livré. */
export function installNode(
  sourceDir: string,
  targetDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const name = platform === 'win32' ? 'node.exe' : 'node';
  const source = path.join(sourceDir, name);
  const target = path.join(targetDir, name);
  const old = `${target}.old`;
  try {
    if (!fs.existsSync(source)) return 'node';
    const version = fs.readFileSync(path.join(sourceDir, VERSION_FILE), 'utf8');
    const versionFile = path.join(targetDir, VERSION_FILE);
    if (
      fs.existsSync(target) &&
      fs.existsSync(versionFile) &&
      fs.readFileSync(versionFile, 'utf8') === version
    ) {
      return target;
    }
    fs.mkdirSync(targetDir, { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.copyFileSync(source, temporary);
    // Windows : un exécutable en cours ne se remplace pas, mais se renomme.
    fs.rmSync(old, { force: true });
    if (fs.existsSync(target)) fs.renameSync(target, old);
    fs.renameSync(temporary, target);
    fs.writeFileSync(versionFile, version);
    return target;
  } catch (error) {
    console.error('[mcp] copie de Node impossible', error);
    if (fs.existsSync(target)) return target;
    return fs.existsSync(source) ? source : 'node';
  } finally {
    try {
      fs.rmSync(old, { force: true });
    } catch {
      // Encore utilisé : retiré à une prochaine mise à jour.
    }
  }
}
