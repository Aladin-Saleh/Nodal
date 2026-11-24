import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deleteLesson,
  LESSON_FILES_MAX,
  listLessons,
  recordLesson,
  saveLessonFiles,
} from '../../../src/main/knowledge/lesson-service';
import { fileFingerprintSync } from '../../../src/main/code/fingerprint';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { useTempDir } from '../../helpers/temp-dir';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();
const tempDir = useTempDir();
const newNode = (title: string) =>
  new NodeService(workspace().context).create({
    parentId: null,
    title,
    nodeType: 'concept',
  }).id;
const base = { client: 'test', nodeIds: [] as string[] };

describe('leçons', () => {
  it('enregistre, liste, supprime ; un nœud supprimé quitte la leçon', () => {
    const { context } = workspace();
    const node = newNode('API');
    const id = recordLesson(context(), {
      ...base,
      question: 'Où est l’API ?',
      outcome: 'useful',
      nodeIds: [node, node],
    });
    expect(listLessons(context(), [])).toMatchObject([
      {
        id,
        key: 'ou est l api',
        nodes: [{ id: node, title: 'API' }],
        stale: false,
      },
    ]);
    new NodeService(context).delete({
      id: node,
      childrenStrategy: 'reparent',
    });
    expect(listLessons(context(), [])[0]!.nodes).toEqual([]);
    deleteLesson(context(), id);
    expect(listLessons(context(), [])).toEqual([]);
    expect(() => deleteLesson(context(), id)).toThrow(/introuvable/);
  });

  it('refuse une leçon qui n’apprend rien, masque les secrets', () => {
    const { context } = workspace();
    const record = (extra: object) => () =>
      recordLesson(context(), {
        ...base,
        question: 'q',
        outcome: 'dead_end',
        ...extra,
      });
    expect(record({ question: ' ?! ' })).toThrow(/vide/);
    expect(record({ outcome: 'corrected' })).toThrow(/ce qui est juste/);
    expect(record({ outcome: 'useful' })).toThrow(/désigne les nœuds/);
    expect(record({ nodeIds: ['absent'] })).toThrow(/introuvable/);
    record({ note: `jeton ghp_${'a1B2'.repeat(10)}` })();
    expect(listLessons(context(), [])[0]!.note).toBe('jeton [masqué]');
  });

  it('est périmée si le code suivi change, pas s’il est absent de la machine', () => {
    const { context } = workspace();
    const root = path.join(tempDir(), 'app');
    const file = path.join(root, 'src', 'a.ts');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'const a = 1;');
    const node = newNode('API');
    const id = recordLesson(context(), {
      ...base,
      question: 'q',
      outcome: 'dead_end',
      nodeIds: [node],
    });
    const files = { 'app/src/a.ts': fileFingerprintSync(file)! };
    saveLessonFiles(context(), id, node, files);
    const stale = () => listLessons(context(), [root])[0]!.stale;
    expect(stale()).toBe(false);
    fs.writeFileSync(file, 'const a =\n  1;');
    expect(stale()).toBe(false);
    fs.writeFileSync(file, 'const a = 2;');
    expect(stale()).toBe(true);
    expect(listLessons(context(), [])[0]!.stale).toBe(false);
    fs.rmSync(file);
    expect(stale()).toBe(true);
  });

  it('ne suit pas un ancrage trop large, ni un chemin hors du dossier', () => {
    const { context } = workspace();
    const node = newNode('API');
    const id = recordLesson(context(), {
      ...base,
      question: 'q',
      outcome: 'dead_end',
      nodeIds: [node],
    });
    const root = path.join(tempDir(), 'app');
    const many = Object.fromEntries(
      Array.from({ length: LESSON_FILES_MAX + 1 }, (_, i) => [`app/${i}`, 'x']),
    );
    saveLessonFiles(context(), id, node, many);
    expect(listLessons(context(), [root])[0]!.stale).toBe(false);
    saveLessonFiles(context(), id, node, { 'app/../secret': 'x' });
    expect(listLessons(context(), [root])[0]!.stale).toBe(false);
  });
});
