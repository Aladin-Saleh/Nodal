import type { Migration } from '../migrations';

/**
 * Nouveaux types de nœuds (fonction, règle, décision, exigence, anomalie,
 * tâche, jalon, risque, acteur) et de documents (csv).
 *
 * SQLite ne sait pas modifier un CHECK : les tables `node` et `document` sont
 * reconstruites à l'identique, données comprises, puis leurs index et
 * triggers recréés (migrations 001, 003, 008). Les clés étrangères sont
 * désactivées le temps de la migration (`disableForeignKeys`) et vérifiées
 * avant le COMMIT ; `legacy_alter_table` évite que le renommage ne contrôle
 * les triggers des autres tables, qui citent `node` alors qu'elle n'existe
 * plus.
 */
export const migration011: Migration = {
  version: 11,
  name: 'more-types',
  disableForeignKeys: true,
  sql: /* sql */ `
PRAGMA legacy_alter_table = ON;

CREATE TABLE node_new (
  id               TEXT PRIMARY KEY NOT NULL,
  workspace_id     TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  parent_id        TEXT REFERENCES node (id) ON DELETE RESTRICT,
  title            TEXT NOT NULL CHECK (length(trim(title)) > 0),
  node_type        TEXT NOT NULL CHECK (node_type IN ('concept', 'component', 'data', 'procedure', 'resource', 'generic', 'function', 'rule', 'decision', 'requirement', 'issue', 'task', 'milestone', 'risk', 'actor')),
  summary          TEXT,
  color            TEXT,
  position_x       REAL,
  position_y       REAL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  position_z       REAL,
  code_reviewed_at TEXT,
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;
INSERT INTO node_new
  (id, workspace_id, parent_id, title, node_type, summary, color, position_x, position_y, sort_order, created_at, updated_at, position_z, code_reviewed_at)
SELECT id, workspace_id, parent_id, title, node_type, summary, color, position_x, position_y, sort_order, created_at, updated_at, position_z, code_reviewed_at
FROM node ORDER BY rowid;
DROP TABLE node;
ALTER TABLE node_new RENAME TO node;
CREATE INDEX node_workspace_idx ON node (workspace_id);
CREATE INDEX node_parent_idx ON node (parent_id, sort_order);

CREATE TABLE document_new (
  id           TEXT PRIMARY KEY NOT NULL,
  node_id      TEXT NOT NULL REFERENCES node (id) ON DELETE RESTRICT,
  title        TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('markdown', 'text', 'json', 'code', 'mermaid', 'csv')),
  language     TEXT CHECK (language IS NULL OR content_type = 'code'),
  body         TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;
INSERT INTO document_new
  (id, node_id, title, content_type, language, body, sort_order, created_at, updated_at)
SELECT id, node_id, title, content_type, language, body, sort_order, created_at, updated_at
FROM document ORDER BY rowid;
DROP TABLE document;
ALTER TABLE document_new RENAME TO document;
CREATE INDEX document_node_idx ON document (node_id, sort_order);

PRAGMA legacy_alter_table = OFF;

CREATE TRIGGER node_parent_same_workspace_insert
BEFORE INSERT ON node
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM node WHERE id = NEW.parent_id AND workspace_id <> NEW.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'nodal: le parent doit appartenir au même espace');
END;

CREATE TRIGGER node_parent_same_workspace_update
BEFORE UPDATE OF parent_id ON node
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM node WHERE id = NEW.parent_id AND workspace_id <> NEW.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'nodal: le parent doit appartenir au même espace');
END;

CREATE TRIGGER node_workspace_immutable
BEFORE UPDATE OF workspace_id ON node
WHEN NEW.workspace_id IS NOT OLD.workspace_id
BEGIN
  SELECT RAISE(ABORT, 'nodal: l''espace d''un nœud ne peut pas changer');
END;

CREATE TRIGGER search_node_insert AFTER INSERT ON node
BEGIN
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('node', NEW.id, NEW.id, NEW.title, COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER search_node_update AFTER UPDATE OF title, summary ON node
BEGIN
  DELETE FROM search_index WHERE kind = 'node' AND item_id = OLD.id;
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('node', NEW.id, NEW.id, NEW.title, COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER search_node_delete AFTER DELETE ON node
BEGIN
  DELETE FROM search_index WHERE kind = 'node' AND item_id = OLD.id;
END;

CREATE TRIGGER link_suggestion_node_delete AFTER DELETE ON node
BEGIN
  DELETE FROM link_suggestion_ignored
  WHERE source_node_id = OLD.id OR target_node_id = OLD.id;
END;

CREATE TRIGGER search_document_insert AFTER INSERT ON document
BEGIN
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('document', NEW.id, NEW.node_id, NEW.title, NEW.body);
END;

CREATE TRIGGER search_document_update AFTER UPDATE OF title, body, node_id ON document
BEGIN
  DELETE FROM search_index WHERE kind = 'document' AND item_id = OLD.id;
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('document', NEW.id, NEW.node_id, NEW.title, NEW.body);
END;

CREATE TRIGGER search_document_delete AFTER DELETE ON document
BEGIN
  DELETE FROM search_index WHERE kind = 'document' AND item_id = OLD.id;
END;
`,
};
