/**
 * Mise à jour automatique de la configuration des assistants IA.
 *
 * Jusqu'à Nodal 1.4.0, la fenêtre « Connecter un assistant » donnait le
 * chemin du serveur dans l'installation (`…\Nodal\app-1.4.0\resources\
 * nodal-mcp.cjs`), qui disparaît à la mise à jour suivante. Au démarrage,
 * Nodal remplace ce chemin par le chemin stable (voir mcp-server-install.ts)
 * dans les fichiers de configuration que la fenêtre fait remplir : rien
 * d'autre n'est modifié, et un fichier sans ancien chemin n'est pas réécrit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MCP_SERVER_FILE_NAME } from './mcp-server-install';

/** Fichiers de configuration propres à un dossier de projet. */
const PROJECT_CONFIG_FILES = [
  '.mcp.json',
  path.join('.cursor', 'mcp.json'),
  path.join('.gemini', 'settings.json'),
  path.join('.vscode', 'mcp.json'),
];

/**
 * Fichiers à examiner : configurations globales des assistants proposés
 * (Claude Code, Claude Desktop, Cursor, Gemini CLI, Codex, VS Code), puis
 * celles des dossiers de projet connus.
 */
export function assistantConfigFiles(options: {
  home: string;
  appData: string;
  projectDirs: readonly string[];
}): string[] {
  const { home, appData, projectDirs } = options;
  const files = [
    path.join(home, '.claude.json'),
    path.join(appData, 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.cursor', 'mcp.json'),
    path.join(home, '.gemini', 'settings.json'),
    path.join(home, '.codex', 'config.toml'),
    path.join(appData, 'Code', 'User', 'mcp.json'),
    path.join(appData, 'Code', 'User', 'settings.json'),
    ...projectDirs.flatMap((dir) =>
      PROJECT_CONFIG_FILES.map((file) => path.join(dir, file)),
    ),
  ];
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = path.resolve(file).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Dossiers de projet où Claude Code a été utilisé (~/.claude.json). */
export function claudeCodeProjects(home: string): string[] {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(path.join(home, '.claude.json'), 'utf8'),
    );
    const projects = (parsed as { projects?: unknown } | null)?.projects;
    return projects && typeof projects === 'object'
      ? Object.keys(projects)
      : [];
  } catch {
    return [];
  }
}

/** Dossiers de code déclarés dans des espaces (réglage `code.roots`). */
export function workspaceCodeRoots(
  workspaceFiles: readonly string[],
): string[] {
  const roots: string[] = [];
  for (const file of workspaceFiles) {
    if (!fs.existsSync(file)) continue;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file);
      db.exec('PRAGMA query_only = ON');
      const rows = db
        .prepare(
          "SELECT value FROM workspace_settings WHERE key = 'code.roots'",
        )
        .all() as { value: string }[];
      for (const row of rows) {
        const parsed: unknown = JSON.parse(row.value);
        if (Array.isArray(parsed)) {
          roots.push(
            ...parsed.filter(
              (item): item is string => typeof item === 'string',
            ),
          );
        }
      }
    } catch {
      // Espace illisible ou verrouillé : ignoré.
    } finally {
      db?.close();
    }
  }
  return roots;
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remplace, dans le texte d'un fichier de configuration, le chemin du
 * serveur d'une version installée (`<installRoot>\app-X.Y.Z\resources\
 * nodal-mcp.cjs`) par `stablePath`, en gardant la notation du fichier :
 * barres obliques inverses doublées (JSON, TOML), simples, ou barres
 * obliques.
 */
export function rewriteServerPath(
  text: string,
  installRoot: string,
  stablePath: string,
): string {
  const rootParts = installRoot.split(/[\\/]+/).filter(Boolean);
  const stableParts = stablePath.split(/[\\/]+/).filter(Boolean);
  let result = text;
  for (const separator of ['\\\\', '\\', '/']) {
    const sep = escapeRegExp(separator);
    const pattern = new RegExp(
      rootParts.map(escapeRegExp).join(sep) +
        `${sep}app-\\d[\\w.-]*${sep}resources${sep}` +
        escapeRegExp(MCP_SERVER_FILE_NAME),
      'gi',
    );
    result = result.replace(pattern, () => stableParts.join(separator));
  }
  return result;
}

/** Met à jour les fichiers qui citent un ancien chemin ; renvoie ceux modifiés. */
export function updateAssistantConfigs(
  files: readonly string[],
  installRoot: string,
  stablePath: string,
): string[] {
  const changed: string[] = [];
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const next = rewriteServerPath(text, installRoot, stablePath);
      if (next === text) continue;
      const temporary = `${file}.${process.pid}.nodal.tmp`;
      fs.writeFileSync(temporary, next);
      fs.renameSync(temporary, file);
      changed.push(file);
    } catch (error) {
      console.error(`[mcp] configuration non mise à jour : ${file}`, error);
    }
  }
  return changed;
}
