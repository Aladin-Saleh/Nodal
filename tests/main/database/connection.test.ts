import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  closeNodalDatabase,
  createNodalDatabase,
  getApplicationId,
  getSqliteVersion,
  NODAL_APPLICATION_ID,
  openNodalDatabase,
} from '../../../src/main/database/connection';
import {
  getSchemaVersion,
  LATEST_SCHEMA_VERSION,
} from '../../../src/main/database/migrations';
import { listFiles, useTempDir } from '../../helpers/temp-dir';

const tempDir = useTempDir();
const projectPath = () => path.join(tempDir(), 'test.nodal');

const pragma = (db: DatabaseSync, name: string) =>
  Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];

const tableNames = (db: DatabaseSync) =>
  (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);

function expectNodalError(fn: () => unknown, code: string) {
  expect(fn).toThrowError(expect.objectContaining({ code }));
}

describe('createNodalDatabase', () => {
  it('crée un fichier neuf migré à la dernière version', () => {
    const db = createNodalDatabase(projectPath());
    try {
      expect(getApplicationId(db)).toBe(NODAL_APPLICATION_ID);
      expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(pragma(db, 'journal_mode')).toBe('wal');
      expect(pragma(db, 'foreign_keys')).toBe(1);
      expect(pragma(db, 'synchronous')).toBe(1); // NORMAL
      expect(pragma(db, 'busy_timeout')).toBe(5000);
      expect(tableNames(db)).toEqual([
        'attachment',
        'document',
        'edge',
        'node',
        'node_tag',
        'relation_type',
        'tag',
        'workspace',
        'workspace_settings',
      ]);
    } finally {
      closeNodalDatabase(db);
    }
  });

  it("refuse d'écraser un fichier existant", () => {
    fs.writeFileSync(projectPath(), 'contenu à préserver');
    expectNodalError(
      () => createNodalDatabase(projectPath()),
      'FILE_ALREADY_EXISTS',
    );
    expect(fs.readFileSync(projectPath(), 'utf8')).toBe('contenu à préserver');
  });

  it('refuse un chemin dont un journal SQLite orphelin existe', () => {
    fs.writeFileSync(`${projectPath()}-wal`, '');
    expectNodalError(
      () => createNodalDatabase(projectPath()),
      'FILE_ALREADY_EXISTS',
    );
    expect(fs.existsSync(projectPath())).toBe(false);
  });
});

describe('openNodalDatabase', () => {
  it('rouvre un fichier existant de façon idempotente', () => {
    const first = createNodalDatabase(projectPath());
    first
      .prepare(
        "INSERT INTO workspace VALUES ('w1', 'Espace', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    closeNodalDatabase(first);

    for (let i = 0; i < 2; i++) {
      const db = openNodalDatabase(projectPath());
      try {
        expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
        expect(pragma(db, 'journal_mode')).toBe('wal');
        expect(pragma(db, 'foreign_keys')).toBe(1);
        expect(db.prepare('SELECT name FROM workspace').all()).toEqual([
          { name: 'Espace' },
        ]);
      } finally {
        closeNodalDatabase(db);
      }
    }
  });

  it('refuse un fichier créé par une version plus récente, sans le modifier', () => {
    closeNodalDatabase(createNodalDatabase(projectPath()));
    const raw = new DatabaseSync(projectPath());
    raw.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    raw.close();
    const before = fs.readFileSync(projectPath());

    expectNodalError(() => openNodalDatabase(projectPath()), 'SCHEMA_TOO_NEW');

    expect(fs.readFileSync(projectPath()).equals(before)).toBe(true);
    expect(listFiles(tempDir())).toEqual(['test.nodal']);
  });

  it('refuse une base SQLite qui n’est pas un fichier Nodal, sans la modifier', () => {
    const foreign = path.join(tempDir(), 'foreign.db');
    const raw = new DatabaseSync(foreign);
    raw.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);');
    raw.close();
    const before = fs.readFileSync(foreign);

    expectNodalError(() => openNodalDatabase(foreign), 'NOT_A_NODAL_FILE');

    expect(fs.readFileSync(foreign).equals(before)).toBe(true);
    expect(listFiles(tempDir())).toEqual(['foreign.db']);
  });

  it('refuse un fichier qui n’est pas une base SQLite', () => {
    const text = path.join(tempDir(), 'notes.nodal');
    fs.writeFileSync(text, 'ceci n’est pas une base SQLite, mais du texte.');
    expectNodalError(() => openNodalDatabase(text), 'NOT_A_NODAL_FILE');
  });

  it('refuse un fichier vide', () => {
    fs.writeFileSync(projectPath(), '');
    expectNodalError(
      () => openNodalDatabase(projectPath()),
      'NOT_A_NODAL_FILE',
    );
  });

  it('signale un fichier introuvable', () => {
    expectNodalError(() => openNodalDatabase(projectPath()), 'FILE_NOT_FOUND');
  });
});

describe('closeNodalDatabase', () => {
  it('ne laisse qu’un seul fichier sur le disque', () => {
    const db = createNodalDatabase(projectPath());
    db.prepare(
      "INSERT INTO workspace VALUES ('w1', 'Espace', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    ).run();
    // Pendant l'édition, SQLite crée les fichiers -wal / -shm.
    expect(listFiles(tempDir())).toEqual([
      'test.nodal',
      'test.nodal-shm',
      'test.nodal-wal',
    ]);

    closeNodalDatabase(db);

    expect(listFiles(tempDir())).toEqual(['test.nodal']);
    expect(db.isOpen).toBe(false);
    // Les données ont bien été fusionnées dans le fichier principal.
    const raw = new DatabaseSync(projectPath(), { readOnly: true });
    expect(raw.prepare('SELECT count(*) AS n FROM workspace').get()).toEqual({
      n: 1,
    });
    raw.close();
  });

  it('est sans effet sur une connexion déjà fermée', () => {
    const db = createNodalDatabase(projectPath());
    closeNodalDatabase(db);
    expect(() => closeNodalDatabase(db)).not.toThrow();
  });
});

describe('getSqliteVersion', () => {
  it('retourne une version SQLite 3.x', () => {
    expect(getSqliteVersion()).toMatch(/^3\.\d+\.\d+$/);
  });
});
