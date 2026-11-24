/**
 * Installation du skill Nodal dans un projet (Claude Code :
 * `.claude/skills/nodal/SKILL.md`). Un fichier que Nodal n'a pas écrit n'est
 * jamais remplacé.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodalError } from '../shared/errors';

/** Marque des fichiers écrits par Nodal. */
export const SKILL_MARKER = 'Installé par Nodal';

export function installSkill(projectDir: string, content: string): string {
  const file = path.join(projectDir, '.claude', 'skills', 'nodal', 'SKILL.md');
  if (
    fs.existsSync(file) &&
    !fs.readFileSync(file, 'utf8').includes(SKILL_MARKER)
  ) {
    throw new NodalError(
      'FILE_ALREADY_EXISTS',
      `${file} existe et n’a pas été écrit par Nodal : il n’est pas remplacé.`,
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.nodal.tmp`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return file;
}
