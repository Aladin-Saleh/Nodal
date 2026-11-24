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

describe('migration 005 : validation de ce qu’a ajouté l’IA', () => {
  it('ajoute validated_at au journal sans toucher aux entrées existantes', () => {
    runMigrations(db, MIGRATIONS.slice(0, 4));
    db.exec(
      "INSERT INTO workspace VALUES ('w', 'W', NULL, 't', 't');" +
        "INSERT INTO assistant_change (id, workspace_id, created_at, client, action, node_id, entity_id, summary) VALUES ('c', 'w', 't', 'claude', 'create_node', 'n', 'n', 'Nœud créé');",
    );
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(
      db
        .prepare(
          'SELECT summary, undone_at, validated_at FROM assistant_change',
        )
        .get(),
    ).toEqual({ summary: 'Nœud créé', undone_at: null, validated_at: null });
  });
});

describe('migration 010 : ancrage aux fichiers du code', () => {
  it('reconstruit le journal à l’identique et accepte l’action anchor', () => {
    runMigrations(db, MIGRATIONS.slice(0, 9));
    db.exec(
      "INSERT INTO workspace VALUES ('w', 'W', NULL, 't', 't');" +
        "INSERT INTO node (id, workspace_id, title, node_type, created_at, updated_at) VALUES ('n', 'w', 'N', 'concept', 't', 't');" +
        "INSERT INTO assistant_change (id, workspace_id, created_at, client, action, node_id, entity_id, summary, validated_at) VALUES ('c2', 'w', 't2', 'claude', 'tag', 'n', 'n', 'Tags', NULL);" +
        "INSERT INTO assistant_change (id, workspace_id, created_at, client, action, node_id, entity_id, summary, validated_at) VALUES ('c1', 'w', 't1', 'claude', 'create_node', 'n', 'n', 'Nœud créé', 'v');",
    );
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(
      db
        .prepare(
          'SELECT id, action, validated_at FROM assistant_change ORDER BY rowid',
        )
        .all(),
    ).toEqual([
      { id: 'c2', action: 'tag', validated_at: null },
      { id: 'c1', action: 'create_node', validated_at: 'v' },
    ]);
    db.exec(
      "INSERT INTO assistant_change (id, workspace_id, created_at, action, entity_id, summary) VALUES ('c3', 'w', 't3', 'anchor', 'n', 'Ancrage');",
    );
    expect(() =>
      db.exec(
        "INSERT INTO assistant_change (id, workspace_id, created_at, action, entity_id, summary) VALUES ('c4', 'w', 't4', 'autre', 'n', 'x');",
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(db.prepare('SELECT code_reviewed_at FROM node').get()).toEqual({
      code_reviewed_at: null,
    });
  });
});

describe('migration 012 : état du code', () => {
  it('garde le journal, accepte l’action review, suit la suppression du nœud', () => {
    runMigrations(db, MIGRATIONS.slice(0, 11));
    db.exec(
      "INSERT INTO workspace VALUES ('w', 'W', NULL, 't', 't');" +
        "INSERT INTO node (id, workspace_id, title, node_type, created_at, updated_at) VALUES ('n', 'w', 'N', 'concept', 't', 't');" +
        "INSERT INTO assistant_change (id, workspace_id, created_at, action, entity_id, summary) VALUES ('c1', 'w', 't', 'anchor', 'n', 'Ancrage');",
    );
    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    db.exec(
      "INSERT INTO assistant_change (id, workspace_id, created_at, action, entity_id, summary) VALUES ('c2', 'w', 't', 'review', 'n', 'Relu');" +
        "INSERT INTO node_code_state VALUES ('n', 't', '[]', '{}');",
    );
    expect(
      db.prepare('SELECT id FROM assistant_change ORDER BY rowid').all(),
    ).toEqual([{ id: 'c1' }, { id: 'c2' }]);
    db.exec("DELETE FROM node WHERE id = 'n'");
    expect(db.prepare('SELECT * FROM node_code_state').all()).toEqual([]);
  });
});

const insert = (sql: string) => db.exec(sql);
const all = (sql: string) => db.prepare(sql).all();

describe('migration 011 : nouveaux types de nœuds et de documents', () => {
  it('reconstruit node et document à l’identique, contraintes et triggers compris', () => {
    runMigrations(db, MIGRATIONS.slice(0, 10));
    insert(
      "INSERT INTO workspace VALUES ('w', 'W', NULL, 't', 't');" +
        "INSERT INTO workspace VALUES ('w2', 'W2', NULL, 't', 't');" +
        "INSERT INTO node (id, workspace_id, title, node_type, summary, position_z, code_reviewed_at, created_at, updated_at) VALUES ('p', 'w', 'Parent', 'concept', 'Résumé', 3, 'r', 't', 't');" +
        "INSERT INTO node (id, workspace_id, parent_id, title, node_type, created_at, updated_at) VALUES ('c', 'w', 'p', 'Enfant', 'data', 't', 't');" +
        "INSERT INTO document (id, node_id, title, content_type, language, body, created_at, updated_at) VALUES ('d', 'c', 'Doc', 'code', 'sql', 'SELECT 1', 't', 't');" +
        "INSERT INTO relation_type (id, workspace_id, name) VALUES ('rt', 'w', 'utilise');" +
        "INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, created_at, updated_at) VALUES ('e', 'w', 'p', 'c', 'rt', 't', 't');" +
        "INSERT INTO link_suggestion_ignored VALUES ('p', 'c', 't');",
    );

    expect(runMigrations(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
    expect(all('PRAGMA foreign_key_check')).toEqual([]);
    expect(
      all(
        'SELECT id, parent_id, node_type, summary, position_z, code_reviewed_at FROM node ORDER BY rowid',
      ),
    ).toEqual([
      {
        id: 'p',
        parent_id: null,
        node_type: 'concept',
        summary: 'Résumé',
        position_z: 3,
        code_reviewed_at: 'r',
      },
      {
        id: 'c',
        parent_id: 'p',
        node_type: 'data',
        summary: null,
        position_z: null,
        code_reviewed_at: null,
      },
    ]);
    expect(all('SELECT id, language, body FROM document')).toEqual([
      { id: 'd', language: 'sql', body: 'SELECT 1' },
    ]);

    // Nouveaux types acceptés, les autres toujours refusés.
    insert(
      "INSERT INTO node (id, workspace_id, title, node_type, created_at, updated_at) VALUES ('f', 'w', 'Fonction', 'function', 't', 't');" +
        "INSERT INTO document (id, node_id, title, content_type, body, created_at, updated_at) VALUES ('csv', 'f', 'Tableau', 'csv', 'a;b', 't', 't');",
    );
    expect(() =>
      insert(
        "INSERT INTO node (id, workspace_id, title, node_type, created_at, updated_at) VALUES ('x', 'w', 'X', 'service', 't', 't');",
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      insert(
        "INSERT INTO document (id, node_id, title, content_type, language, created_at, updated_at) VALUES ('y', 'f', 'Y', 'csv', 'sql', 't', 't');",
      ),
    ).toThrow(/CHECK constraint failed/);

    // Clés étrangères et triggers recréés.
    expect(() =>
      insert(
        "INSERT INTO document (id, node_id, title, content_type, created_at, updated_at) VALUES ('z', 'ghost', 'Z', 'text', 't', 't');",
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => insert("DELETE FROM node WHERE id = 'c'")).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(() =>
      insert(
        "INSERT INTO node (id, workspace_id, parent_id, title, node_type, created_at, updated_at) VALUES ('o', 'w2', 'p', 'Autre', 'task', 't', 't');",
      ),
    ).toThrow(/même espace/);
    expect(
      all(
        "SELECT kind, item_id FROM search_index WHERE search_index MATCH 'tableau OR fonction' ORDER BY kind",
      ),
    ).toEqual([
      { kind: 'document', item_id: 'csv' },
      { kind: 'node', item_id: 'f' },
    ]);
    insert(
      "DELETE FROM edge; DELETE FROM document WHERE node_id = 'c'; DELETE FROM node WHERE id = 'c';",
    );
    expect(all('SELECT * FROM link_suggestion_ignored')).toEqual([]);
  });
});

describe('disableForeignKeys', () => {
  it('refuse une migration qui laisse une référence invalide et rétablit les clés étrangères', () => {
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'tables',
        sql: 'CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (p_id TEXT REFERENCES p (id));',
      },
      {
        version: 2,
        name: 'orphan',
        disableForeignKeys: true,
        sql: "INSERT INTO c VALUES ('ghost');",
      },
    ];
    expect(() => runMigrations(db, migrations)).toThrowError(
      expect.objectContaining({ code: 'MIGRATION_FAILED' }),
    );
    expect(getSchemaVersion(db)).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM c').get()).toEqual({ n: 0 });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
  });
});
