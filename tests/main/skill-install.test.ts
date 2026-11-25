import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  installSkills,
  SKILL_FILES,
  SKILL_MARKER,
} from '../../src/main/skill-install';
import { useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();

it('livre les skills, nommés comme leur dossier', () => {
  expect([...SKILL_FILES.keys()].toSorted()).toEqual([
    'nodal-contrats/SKILL.md',
    'nodal-init/SKILL.md',
    'nodal-maj/SKILL.md',
    'nodal-module/SKILL.md',
    'nodal-schemas/SKILL.md',
    'nodal/SKILL.md',
    'nodal/conventions.md',
  ]);
  for (const [file, content] of SKILL_FILES) {
    expect(content).toContain(SKILL_MARKER);
    const [folder, name] = file.split('/');
    if (name === 'SKILL.md')
      expect(content).toMatch(
        new RegExp(`^---\\r?\\nname: ${folder}\\r?\\ndescription: `),
      );
    // Renvois d'un skill à l'autre : fichiers livrés.
    for (const [, target] of content.matchAll(/`\.\.\/([^`]+\.md)`/g))
      expect(SKILL_FILES.has(target!)).toBe(true);
  }
});

it('écrit les skills, les remplace, mais pas un fichier d’un autre', () => {
  const dir = tempDir();
  const skills = path.join(dir, '.claude', 'skills');
  expect(installSkills(dir)).toBe(skills);
  for (const [file, content] of SKILL_FILES)
    expect(fs.readFileSync(path.join(skills, file), 'utf8')).toBe(content);
  expect(fs.readdirSync(path.join(skills, 'nodal')).toSorted()).toEqual([
    'SKILL.md',
    'conventions.md',
  ]);

  // Un fichier d'un autre : rien n'est écrit.
  const mine = path.join(skills, 'nodal-module', 'SKILL.md');
  fs.writeFileSync(mine, 'le mien');
  const changed = new Map(
    [...SKILL_FILES].map(([file, content]) => [file, `${content}\n`]),
  );
  expect(() => installSkills(dir, changed)).toThrow(/pas été écrit par Nodal/);
  expect(fs.readFileSync(mine, 'utf8')).toBe('le mien');
  expect(fs.readFileSync(path.join(skills, 'nodal/SKILL.md'), 'utf8')).toBe(
    SKILL_FILES.get('nodal/SKILL.md'),
  );

  fs.rmSync(mine);
  installSkills(dir, changed);
  expect(fs.readFileSync(mine, 'utf8')).toBe(
    changed.get('nodal-module/SKILL.md'),
  );
});
