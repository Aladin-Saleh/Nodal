import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkCode,
  describeAnchors,
  findStaleNodes,
  snapshotsAfterWrite,
} from '../../../src/main/code/code-check';
import {
  filesCommittedSince,
  findGitExecutable,
  isGitWorkTree,
} from '../../../src/main/code/git-history';
import type { AnchoredNode } from '../../../src/main/knowledge/anchor-service';
import {
  contentFingerprint,
  matchesGitBlob,
} from '../../../src/main/code/fingerprint';
import { useTempDir } from '../../helpers/temp-dir';

const tempDir = useTempDir();
const git = findGitExecutable();
const SINCE = '2026-06-01T12:00:00.000Z';
const BEFORE = new Date('2026-05-01T12:00:00Z');
const AFTER = new Date('2026-07-01T12:00:00Z');

function write(root: string, relative: string, content = 'x', mtime?: Date) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

/** Commit daté (auteur et committeur) de tout le dossier. */
function commit(root: string, date: Date, message = 'm') {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: date.toISOString(),
    GIT_COMMITTER_DATE: date.toISOString(),
  };
  const run = (...args: string[]) =>
    execFileSync(git!, ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      env,
      stdio: 'pipe',
    });
  run('add', '-A');
  run('commit', '-q', '--allow-empty', '-m', message);
}

function initRepo(root: string) {
  execFileSync(git!, ['init', '-q', '-b', 'main'], {
    cwd: root,
    stdio: 'pipe',
  });
}

const node = (patterns: string[], since = SINCE): AnchoredNode => ({
  nodeId: 'n1',
  title: 'Nœud',
  patterns,
  since,
});

describe('findGitExecutable', () => {
  it('ignore les dossiers relatifs du PATH (dossier courant)', () => {
    const dir = tempDir();
    const name = process.platform === 'win32' ? 'git.exe' : 'git';
    fs.writeFileSync(path.join(dir, name), '');
    const relative = path.relative(process.cwd(), dir);
    expect(findGitExecutable(relative)).toBeNull();
    expect(findGitExecutable(dir)).toBe(path.join(dir, name));
  });
});

describe('dossier sans git : dates de modification', () => {
  it('signale les fichiers modifiés depuis la date de référence', async () => {
    const root = tempDir();
    write(root, 'src/old.ts', 'a', BEFORE);
    write(root, 'src/new.ts', 'b', AFTER);
    write(root, 'other/new.ts', 'c', AFTER);
    const [stale] = await findStaleNodes([root], [node(['src/**'])]);
    expect(stale).toMatchObject({
      nodeId: 'n1',
      source: 'mtime',
      fileCount: 1,
      files: [{ path: 'src/new.ts', changedAt: AFTER.toISOString() }],
    });
    expect(await findStaleNodes([root], [node(['src/old.ts'])])).toEqual([]);
  });

  it('ignore les dossiers de code absents', async () => {
    expect(
      await findStaleNodes([path.join(tempDir(), 'absent')], [node(['**'])]),
    ).toEqual([]);
  });
});

describe.skipIf(!git)('dossier sous git', () => {
  it('compare la date du dernier commit à la date de référence', async () => {
    const root = tempDir();
    initRepo(root);
    write(root, 'src/a.ts', 'v1', BEFORE);
    write(root, 'src/b.ts', 'v1', BEFORE);
    commit(root, BEFORE);
    expect(await isGitWorkTree(root)).toBe(true);
    expect(await findStaleNodes([root], [node(['src/**'])])).toEqual([]);

    write(root, 'src/a.ts', 'v2', AFTER);
    commit(root, AFTER);
    const [stale] = await findStaleNodes([root], [node(['src/**'])]);
    expect(stale).toMatchObject({
      source: 'content',
      fileCount: 1,
      files: [{ path: 'src/a.ts', changedAt: AFTER.toISOString() }],
    });
  });

  it('ne signale pas un commit postérieur d’un fichier modifié avant la mise à jour', async () => {
    // Modifier le code, mettre la documentation à jour, puis committer.
    const root = tempDir();
    initRepo(root);
    write(root, 'src/a.ts', 'v1', BEFORE);
    commit(root, BEFORE);
    write(root, 'src/a.ts', 'v2', BEFORE);
    commit(root, AFTER);
    expect(await findStaleNodes([root], [node(['src/a.ts'])])).toEqual([]);
  });

  it('signale un fichier supprimé depuis', async () => {
    const root = tempDir();
    initRepo(root);
    write(root, 'src/a.ts', 'v1', BEFORE);
    write(root, 'src/keep.ts', 'v1', BEFORE);
    commit(root, BEFORE);
    fs.rmSync(path.join(root, 'src', 'a.ts'));
    commit(root, AFTER);
    const [stale] = await findStaleNodes([root], [node(['src/*.ts'])]);
    expect(stale?.files).toEqual([
      { path: 'src/a.ts', changedAt: AFTER.toISOString(), deleted: true },
    ]);
  });

  it('accepte un dossier de code qui est un sous-dossier du dépôt', async () => {
    const repo = tempDir();
    initRepo(repo);
    write(repo, 'app/src/a.ts', 'v1', AFTER);
    write(repo, 'src/a.ts', 'v1', AFTER);
    commit(repo, AFTER);
    const committed = await filesCommittedSince(
      path.join(repo, 'app'),
      ['src/**'],
      new Date(SINCE),
    );
    expect([...committed.keys()]).toEqual(['src/a.ts']);
  });

  it('préfixe les chemins du nom du dossier quand il y en a plusieurs', async () => {
    const one = path.join(tempDir(), 'one');
    const two = path.join(tempDir(), 'two');
    fs.mkdirSync(one);
    fs.mkdirSync(two);
    write(one, 'src/a.ts', 'x', AFTER);
    write(two, 'src/a.ts', 'x', AFTER);
    const [stale] = await findStaleNodes([one, two], [node(['src/**'])]);
    expect(stale?.files.map((file) => file.path).toSorted()).toEqual([
      'one/src/a.ts',
      'two/src/a.ts',
    ]);
  });
});

describe('describeAnchors', () => {
  it('liste les fichiers de chaque motif, introuvable si aucun', async () => {
    const root = tempDir();
    write(root, 'src/mcp/a.ts');
    write(root, 'src/mcp/sub/b.ts');
    write(root, 'src/mcp/node_modules/x.ts');
    write(root, 'README.md');
    const result = await describeAnchors(
      [root],
      ['src/mcp/**', 'README.md', 'src/absent.ts', 'src/mcp'],
    );
    expect(result).toEqual([
      {
        pattern: 'src/mcp/**',
        files: ['src/mcp/a.ts', 'src/mcp/sub/b.ts'],
        count: 2,
        truncated: false,
      },
      {
        pattern: 'README.md',
        files: ['README.md'],
        count: 1,
        truncated: false,
      },
      { pattern: 'src/absent.ts', files: [], count: 0, truncated: false },
      {
        pattern: 'src/mcp',
        files: ['src/mcp/a.ts', 'src/mcp/sub/b.ts'],
        count: 2,
        truncated: false,
      },
    ]);
  });
});

const print = (text: string, name = 'a.ts') =>
  contentFingerprint(Buffer.from(text), name);
const doc = (status: string, text: string) =>
  print(`---\nstatus: ${status}\n---\n# ${text}\n`, 'a.md');
const binary = (text: string) =>
  contentFingerprint(Buffer.from(`\0${text}`), 'a.bin');

describe('empreinte de contenu', () => {
  it('ignore la mise en forme, pas le contenu', () => {
    const before = "const a = f('x', [1, 2]);\n";
    expect(print('type A = | 1 | 2;\nif (a || b) { c; }')).toBe(
      print('type A = 1 | 2;\nif (a || b) { c }'),
    );
    expect(print('const a = f(\r\n  "x",\r\n  [1, 2],\r\n);')).toBe(
      print(before),
    );
    expect(print("const a = f('x', [1, 3]);\n")).not.toBe(print(before));
    expect(print('x as | A | B')).toBe(print('x as A | B'));
    expect(print('alias | A')).not.toBe(print('alias A'));
    // Deux mots ne se confondent pas avec un seul.
    expect(print('return x')).not.toBe(print('returnx'));
  });

  it('garde l’indentation là où elle a un sens', () => {
    expect(print('if a:\n  b\nc', 'a.py')).not.toBe(
      print('if a:\n  b\n  c', 'a.py'),
    );
    expect(print('a:  \r\n  b\n', 'a.py')).toBe(print('a:\n  b', 'a.py'));
  });

  it('ignore l’en-tête YAML d’un Markdown', () => {
    expect(doc('brouillon', 'Titre')).toBe(doc('relu', 'Titre'));
    expect(doc('relu', 'Titre')).not.toBe(doc('relu', 'Autre'));
  });

  it('ne normalise pas un fichier binaire', () => {
    expect(binary('a  b')).not.toBe(binary('a b'));
  });
});

/** Nœud à jour : son état est relevé et gardé. */
const recorded = async (root: string, anchored: AnchoredNode) => {
  const { snapshots } = await checkCode([root], [anchored]);
  return { ...anchored, snapshot: snapshots[0]!.snapshot };
};

describe('état du code enregistré', () => {
  it('compare le contenu, pas la date', async () => {
    const root = tempDir();
    write(root, 'src/a.ts', 'const a = 1;', BEFORE);
    const known = await recorded(root, node(['src/**']));
    // Réécrit à l'identique, puis remis en forme.
    write(root, 'src/a.ts', 'const a = 1;', AFTER);
    expect(await findStaleNodes([root], [known])).toEqual([]);
    write(root, 'src/a.ts', 'const a =\n  1;\n', AFTER);
    expect(await findStaleNodes([root], [known])).toEqual([]);
    // Changé, même avec une date ancienne (fichier extrait d'une archive).
    write(root, 'src/a.ts', 'const a = 2;', BEFORE);
    const [stale] = await findStaleNodes([root], [known]);
    expect(stale).toMatchObject({ fileCount: 1, source: 'content' });
    // Contenu rétabli.
    write(root, 'src/a.ts', 'const a = 1;', AFTER);
    expect(await findStaleNodes([root], [known])).toEqual([]);
  });

  it('signale les fichiers ajoutés et supprimés', async () => {
    const root = tempDir();
    write(root, 'src/a.ts', 'a', BEFORE);
    const known = await recorded(root, node(['src/**']));
    fs.rmSync(path.join(root, 'src', 'a.ts'));
    write(root, 'src/b.ts', 'b', BEFORE);
    const [stale] = await findStaleNodes([root], [known]);
    expect(
      stale?.files.map(({ path: file, added, deleted }) => [
        file,
        added ?? deleted,
      ]),
    ).toEqual([
      ['src/a.ts', true],
      ['src/b.ts', true],
    ]);
  });

  it('n’est relevé à nouveau que si le nœud a changé', async () => {
    const root = tempDir();
    write(root, 'src/a.ts', 'a', BEFORE);
    const known = await recorded(root, node(['src/**']));
    expect((await checkCode([root], [known])).snapshots).toEqual([]);
    const later = { ...known, since: '2026-08-01T00:00:00.000Z' };
    const [again] = (await checkCode([root], [later])).snapshots;
    expect(again?.snapshot.since).toBe(later.since);
    // Motif ajouté : les fichiers déjà suivis gardent leur référence.
    write(root, 'src/a.ts', 'changé', BEFORE);
    write(root, 'docs/x.md', 'x', BEFORE);
    const wider = { ...known, patterns: ['src/**', 'docs/**'] };
    const checked = await checkCode([root], [wider]);
    expect(checked.stale[0]?.files.map((file) => file.path)).toEqual([
      'src/a.ts',
    ]);
    expect(Object.keys(checked.snapshots[0]!.snapshot.files)).toHaveLength(2);
  });

  it('ignore les fichiers d’un dossier de code absent de la machine', async () => {
    const root = tempDir();
    write(root, 'src/a.ts', 'a', BEFORE);
    const known = await recorded(root, node(['src/**']));
    const files = { ...known.snapshot.files, 'autre/src/b.ts': 'x' };
    expect(
      await findStaleNodes(
        [root],
        [{ ...known, snapshot: { ...known.snapshot, files } }],
      ),
    ).toEqual([]);
  });

  it('après une écriture, seuls les fichiers vus sont à jour', async () => {
    const root = tempDir();
    for (const name of ['same', 'read', 'unread', 'gone'])
      write(root, `src/${name}.ts`, 'v1', BEFORE);
    const before = await recorded(root, node(['src/**']));
    for (const name of ['read', 'unread'])
      write(root, `src/${name}.ts`, 'v2', AFTER);
    fs.rmSync(path.join(root, 'src', 'gone.ts'));
    const after = { ...node(['src/**']), since: '2026-08-01T00:00:00.000Z' };
    const apply = async (reviewed: string[]) => {
      const [saved] = await snapshotsAfterWrite(
        [root],
        [
          {
            before,
            after,
            isRead: (file) => file.relative === 'src/read.ts',
            reviewed,
          },
        ],
      );
      const [stale] = await findStaleNodes(
        [root],
        [{ ...after, snapshot: saved!.snapshot }],
      );
      return stale?.files.map((file) => file.path).toSorted() ?? [];
    };
    expect(await apply([])).toEqual(['src/gone.ts', 'src/unread.ts']);
    expect(await apply(['src/unread.ts', 'src/gone.ts'])).toEqual([]);
  });

  it('un nœud créé à l’instant reflète le code actuel', async () => {
    const root = tempDir();
    write(root, 'src/a.ts', 'a', AFTER);
    const after = node(['src/**']);
    const [saved] = await snapshotsAfterWrite(
      [root],
      [{ before: null, after, isRead: () => false, reviewed: [] }],
    );
    expect(
      await findStaleNodes([root], [{ ...after, snapshot: saved!.snapshot }]),
    ).toEqual([]);
  });
});

describe.skipIf(!git)('contenu de référence lu dans git', () => {
  it('signale une modification non committée, pas un fichier réécrit', async () => {
    const root = tempDir();
    initRepo(root);
    write(root, 'src/a.ts', 'const a = 1;\n', BEFORE);
    write(root, 'src/b.ts', 'const b = 1;\n', BEFORE);
    commit(root, BEFORE);
    // Changement de branche aller-retour, puis mise en forme committée.
    write(root, 'src/a.ts', 'const a = 1;\n', AFTER);
    write(root, 'src/b.ts', 'const b =\n  1;\n', AFTER);
    commit(root, AFTER);
    expect(await findStaleNodes([root], [node(['src/**'])])).toEqual([]);
    write(root, 'src/a.ts', 'const a = 2;\n', AFTER);
    const [stale] = await findStaleNodes([root], [node(['src/**'])]);
    expect(stale?.files.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  it('ignore les fichiers exclus par .gitignore', async () => {
    const root = tempDir();
    initRepo(root);
    write(root, '.gitignore', 'src/dist/\n', BEFORE);
    write(root, 'src/a.ts', 'a', BEFORE);
    commit(root, BEFORE);
    write(root, 'src/dist/a.js', 'a', AFTER);
    expect(await findStaleNodes([root], [node(['src/**'])])).toEqual([]);
  });

  it('reconnaît un objet git aux fins de ligne près', async () => {
    const root = tempDir();
    initRepo(root);
    write(root, 'a.txt', 'un\ndeux\n');
    const id = execFileSync(git!, ['hash-object', 'a.txt'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const file = path.join(root, 'a.txt');
    expect(await matchesGitBlob(file, id)).toBe(true);
    write(root, 'a.txt', 'un\r\ndeux\r\n');
    expect(await matchesGitBlob(file, id)).toBe(true);
    write(root, 'a.txt', 'trois\n');
    expect(await matchesGitBlob(file, id)).toBe(false);
  });
});
