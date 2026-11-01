import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeAnchors,
  findStaleNodes,
} from '../../../src/main/code/code-check';
import {
  filesCommittedSince,
  findGitExecutable,
  isGitWorkTree,
} from '../../../src/main/code/git-history';
import type { AnchoredNode } from '../../../src/main/knowledge/anchor-service';
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
      source: 'git',
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
