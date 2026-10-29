import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  recentId,
  RecentWorkspacesStore,
} from '../../../src/main/workspace/recent-workspaces';
import { useTempDir } from '../../helpers/temp-dir';

const tempDir = useTempDir();

function newStore() {
  let tick = 0;
  return new RecentWorkspacesStore(
    path.join(tempDir(), 'profil', 'recent.json'),
    () => new Date(Date.UTC(2026, 9, 29, 12, 0, tick++)),
  );
}

describe('RecentWorkspacesStore', () => {
  it('liste les espaces du plus récent au plus ancien, sans doublon', () => {
    const store = newStore();
    const a = path.join(tempDir(), 'a.nodal');
    const b = path.join(tempDir(), 'b.nodal');
    fs.writeFileSync(a, '');
    store.touch(a, 'A');
    store.touch(b, 'B');
    store.touch(a, 'A renommé');

    const list = store.list();
    expect(list.map((entry) => [entry.name, entry.exists])).toEqual([
      ['A renommé', true],
      ['B', false],
    ]);
    expect(store.resolve(list[1]!.id)).toBe(b);
  });

  it('identifie un chemin indépendamment de la casse sous Windows', () => {
    if (process.platform !== 'win32') return;
    expect(recentId('C:\\KB\\Base.nodal')).toBe(recentId('c:\\kb\\base.NODAL'));
  });

  it('retire une entrée et limite la liste à 10 éléments', () => {
    const store = newStore();
    for (let i = 0; i < 12; i++)
      store.touch(path.join(tempDir(), `${i}.nodal`), `E${i}`);
    expect(store.list()).toHaveLength(10);
    const first = store.list()[0]!;
    store.remove(first.id);
    expect(store.list().map((entry) => entry.name)).not.toContain(first.name);
    expect(store.resolve(first.id)).toBeNull();
  });

  it('ignore un fichier de récents corrompu', () => {
    const store = newStore();
    const storePath = path.join(tempDir(), 'profil', 'recent.json');
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, '{ pas du json');
    expect(store.list()).toEqual([]);
    store.touch(path.join(tempDir(), 'x.nodal'), 'X');
    expect(store.list()).toHaveLength(1);
  });
});
