/**
 * Installation des skills Nodal dans un projet (Claude Code :
 * `.claude/skills/nodal…/`). Un fichier que Nodal n'a pas écrit n'est jamais
 * remplacé ; s'il y en a un, rien n'est écrit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodalError } from '../shared/errors';

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

/** Écrit les skills ; renvoie leur dossier. */
export function installSkills(
  projectDir: string,
  files: ReadonlyMap<string, string> = SKILL_FILES,
): string {
  const directory = path.join(projectDir, '.claude', 'skills');
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
