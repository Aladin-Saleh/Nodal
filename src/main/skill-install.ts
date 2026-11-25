/**
 * Installation des skills Nodal dans un projet (`.claude/skills` pour Claude
 * Code, `.agents/skills` pour les autres assistants). Un fichier que Nodal
 * n'a pas écrit n'est jamais remplacé ; s'il y en a un, rien n'est écrit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodalError } from '../shared/errors';
import type { McpClient } from '../shared/mcp-clients';

/** Marque des fichiers écrits par Nodal. */
export const SKILL_MARKER = 'Installé par Nodal';

const ASSETS = '../../assets/skills/';

/** Fichiers livrés (`nodal/SKILL.md`…), par chemin relatif, et leur contenu. */
export const SKILL_FILES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob<string>('../../assets/skills/**/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([file, content]) => [file.slice(ASSETS.length), content]),
);

const CLAUDE_SKILLS = path.join('.claude', 'skills');
const OTHER_SKILLS = path.join('.agents', 'skills');

/** Dossier des skills d'un projet, pour un assistant. */
export const skillsDirectory = (projectDir: string, client: McpClient) =>
  path.join(
    projectDir,
    client === 'claude-code' ? CLAUDE_SKILLS : OTHER_SKILLS,
  );

/**
 * Met à jour les skills là où Nodal les a déjà installés (au démarrage, après
 * une mise à jour) ; renvoie les dossiers modifiés.
 */
export function refreshSkills(projectDirs: readonly string[]): string[] {
  const changed: string[] = [];
  const directories = new Set(
    projectDirs.flatMap((dir) =>
      [CLAUDE_SKILLS, OTHER_SKILLS].map((skills) => path.resolve(dir, skills)),
    ),
  );
  for (const directory of directories) {
    try {
      const read = (file: string) => {
        const target = path.join(directory, file);
        return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
      };
      if (!read('nodal/SKILL.md')?.includes(SKILL_MARKER)) continue;
      // Fins de ligne : git peut les avoir changées, ce n'est pas une différence.
      const same = [...SKILL_FILES].every(
        ([file, content]) =>
          read(file)?.replaceAll('\r\n', '\n') ===
          content.replaceAll('\r\n', '\n'),
      );
      if (same) continue;
      installSkills(directory);
      changed.push(directory);
    } catch (error) {
      console.error(`[mcp] skills non mis à jour : ${directory}`, error);
    }
  }
  return changed;
}

/** Écrit les skills dans un dossier de skills, et le renvoie. */
export function installSkills(
  directory: string,
  files: ReadonlyMap<string, string> = SKILL_FILES,
): string {
  const targets = [...files].map(([relative, content]) => ({
    file: path.join(directory, relative),
    content,
  }));
  for (const { file } of targets) {
    if (
      fs.existsSync(file) &&
      !fs.readFileSync(file, 'utf8').includes(SKILL_MARKER)
    ) {
      throw new NodalError(
        'FILE_ALREADY_EXISTS',
        `${file} existe et n’a pas été écrit par Nodal : il n’est pas remplacé.`,
      );
    }
  }
  for (const { file, content } of targets) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.nodal.tmp`;
    try {
      fs.writeFileSync(temporary, content);
      fs.renameSync(temporary, file);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }
  return directory;
}
