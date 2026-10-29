import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSchemaVersion,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
  type Migration,
} from '../../../src/main/database/migrations';

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
});

afterEach(() => {
  db.close();
});

describe('MIGRATIONS', () => {
  it('a des versions contiguës à partir de 1', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(
      MIGRATIONS.map((_, index) => index + 1),
    );
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.at(-1)?.version);
  });
});

describe('runMigrations', () => {
  it('migre une base vide jusqu’à la dernière version', () => {
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('est idempotente', () => {
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('refuse une base dont le schéma est plus récent', () => {
    db.exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    expect(() => runMigrations(db)).toThrowError(
      expect.objectContaining({ code: 'SCHEMA_TOO_NEW' }),
    );
  });

  it('annule entièrement une migration en échec', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE a (x INTEGER);' },
      {
        version: 2,
        name: 'broken',
        sql: 'CREATE TABLE b (x INTEGER); INSERT INTO missing VALUES (1);',
      },
    ];

    expect(() => runMigrations(db, migrations)).toThrowError(
      expect.objectContaining({ code: 'MIGRATION_FAILED' }),
    );

    expect(getSchemaVersion(db)).toBe(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    expect(tables).toEqual([{ name: 'a' }]);
    expect(db.isTransaction).toBe(false);
  });

  it('n’applique que les migrations manquantes', () => {
    const migrations: Migration[] = [
      { version: 1, name: 'a', sql: 'CREATE TABLE a (x INTEGER);' },
      { version: 2, name: 'b', sql: 'CREATE TABLE b (x INTEGER);' },
    ];
    runMigrations(db, migrations.slice(0, 1));
    expect(runMigrations(db, migrations)).toBe(2);
  });

  it('migre un fichier v1 existant en conservant ses données (ajout de position_z)', () => {
    runMigrations(db, MIGRATIONS.slice(0, 1));
    db.exec(
      "INSERT INTO workspace VALUES ('w', 'W', NULL, 't', 't');" +
        "INSERT INTO node (id, workspace_id, title, node_type, position_x, position_y, created_at, updated_at) VALUES ('n', 'w', 'N', 'concept', 1, 2, 't', 't');",
    );
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(
      db.prepare('SELECT position_x, position_y, position_z FROM node').get(),
    ).toEqual({ position_x: 1, position_y: 2, position_z: null });
  });
});
