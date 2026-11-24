import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import skill from '../../assets/skills/nodal/SKILL.md?raw';
import { installSkill, SKILL_MARKER } from '../../src/main/skill-install';
import { useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();

it('écrit le skill, le remplace, mais pas un fichier d’un autre', () => {
  const dir = tempDir();
  const file = installSkill(dir, skill);
  expect(path.relative(dir, file).split(path.sep).join('/')).toBe(
    '.claude/skills/nodal/SKILL.md',
  );
  expect(skill).toContain(SKILL_MARKER);
  expect(skill).toMatch(/^---\r?\nname: nodal\r?\ndescription: /);
  expect(installSkill(dir, `${skill}\n`)).toBe(file);
  fs.writeFileSync(file, 'le mien');
  expect(() => installSkill(dir, skill)).toThrow(/pas été écrit par Nodal/);
  expect(fs.readFileSync(file, 'utf8')).toBe('le mien');
  expect(fs.readdirSync(path.dirname(file))).toEqual(['SKILL.md']);
});
