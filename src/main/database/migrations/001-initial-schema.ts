import type { Migration } from '../migrations';

/**
 * Schéma initial (§5.1).
 *
 * - Identifiants TEXT (UUID), dates TEXT au format ISO 8601 (UTC).
 * - Tables STRICT : SQLite refuse les valeurs du mauvais type.
 * - Clés étrangères ON DELETE RESTRICT : aucune suppression en cascade
 *   silencieuse (§5.4), sauf les lignes d'association node_tag.
 * - La version du schéma n'est pas dupliquée dans la table workspace : la
 *   source de vérité est PRAGMA user_version.
 * - Une migration publiée est figée : ne jamais la modifier, en ajouter une
 *   nouvelle. Les listes des CHECK sont donc écrites en dur (un test vérifie
 *   qu'elles correspondent à shared/domain.ts).
 * - La détection des cycles parent-enfant est faite côté service (lot 2) :
 *   SQLite n'accepte pas de WITH RECURSIVE dans un trigger.
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial-schema',
  sql: /* sql */ `
CREATE TABLE workspace (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) STRICT;

CREATE TABLE node (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  parent_id    TEXT REFERENCES node (id) ON DELETE RESTRICT,
  title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
  node_type    TEXT NOT NULL CHECK (node_type IN ('concept', 'component', 'data', 'procedure', 'resource', 'generic')),
  summary      TEXT,
  color        TEXT,
  position_x   REAL,
  position_y   REAL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;
CREATE INDEX node_workspace_idx ON node (workspace_id);
CREATE INDEX node_parent_idx ON node (parent_id, sort_order);

CREATE TABLE document (
  id           TEXT PRIMARY KEY NOT NULL,
  node_id      TEXT NOT NULL REFERENCES node (id) ON DELETE RESTRICT,
  title        TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('markdown', 'text', 'json', 'code', 'mermaid')),
  language     TEXT CHECK (language IS NULL OR content_type = 'code'),
  body         TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;
CREATE INDEX document_node_idx ON document (node_id, sort_order);

CREATE TABLE relation_type (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  name         TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
  color        TEXT,
  is_builtin   INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  UNIQUE (workspace_id, name)
) STRICT;

CREATE TABLE edge (
  id               TEXT PRIMARY KEY NOT NULL,
  workspace_id     TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  source_node_id   TEXT NOT NULL REFERENCES node (id) ON DELETE RESTRICT,
  target_node_id   TEXT NOT NULL REFERENCES node (id) ON DELETE RESTRICT,
  relation_type_id TEXT NOT NULL REFERENCES relation_type (id) ON DELETE RESTRICT,
  label            TEXT,
  description      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;
CREATE INDEX edge_workspace_idx ON edge (workspace_id);
CREATE INDEX edge_source_idx ON edge (source_node_id);
CREATE INDEX edge_target_idx ON edge (target_node_id);
CREATE INDEX edge_relation_type_idx ON edge (relation_type_id);

CREATE TABLE attachment (
  id          TEXT PRIMARY KEY NOT NULL,
  node_id     TEXT REFERENCES node (id) ON DELETE RESTRICT,
  document_id TEXT REFERENCES document (id) ON DELETE RESTRICT,
  file_name   TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
  data        BLOB NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes = length(data)),
  checksum    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  CHECK (node_id IS NOT NULL OR document_id IS NOT NULL)
) STRICT;
CREATE INDEX attachment_node_idx ON attachment (node_id);
CREATE INDEX attachment_document_idx ON attachment (document_id);

CREATE TABLE tag (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  name         TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
  color        TEXT,
  UNIQUE (workspace_id, name)
) STRICT;

CREATE TABLE node_tag (
  node_id TEXT NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tag (id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, tag_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX node_tag_tag_idx ON node_tag (tag_id);

CREATE TABLE workspace_settings (
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key)
) STRICT, WITHOUT ROWID;

-- Appartenance au même espace (§5.4). Une référence inexistante n'est pas
-- interceptée ici : elle est laissée à la clé étrangère.

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

-- L'espace d'un élément est immuable : sinon un changement contournerait les
-- triggers ci-dessus côté enfants et relations.
CREATE TRIGGER node_workspace_immutable
BEFORE UPDATE OF workspace_id ON node
WHEN NEW.workspace_id IS NOT OLD.workspace_id
BEGIN
  SELECT RAISE(ABORT, 'nodal: l''espace d''un nœud ne peut pas changer');
END;

CREATE TRIGGER relation_type_workspace_immutable
BEFORE UPDATE OF workspace_id ON relation_type
WHEN NEW.workspace_id IS NOT OLD.workspace_id
BEGIN
  SELECT RAISE(ABORT, 'nodal: l''espace d''un type de relation ne peut pas changer');
END;

CREATE TRIGGER tag_workspace_immutable
BEFORE UPDATE OF workspace_id ON tag
WHEN NEW.workspace_id IS NOT OLD.workspace_id
BEGIN
  SELECT RAISE(ABORT, 'nodal: l''espace d''un tag ne peut pas changer');
END;

CREATE TRIGGER edge_same_workspace_insert
BEFORE INSERT ON edge
WHEN EXISTS (SELECT 1 FROM node WHERE id = NEW.source_node_id AND workspace_id <> NEW.workspace_id)
  OR EXISTS (SELECT 1 FROM node WHERE id = NEW.target_node_id AND workspace_id <> NEW.workspace_id)
  OR EXISTS (SELECT 1 FROM relation_type WHERE id = NEW.relation_type_id AND workspace_id <> NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'nodal: les extrémités et le type d''une relation doivent appartenir au même espace');
END;

CREATE TRIGGER edge_same_workspace_update
BEFORE UPDATE OF workspace_id, source_node_id, target_node_id, relation_type_id ON edge
WHEN EXISTS (SELECT 1 FROM node WHERE id = NEW.source_node_id AND workspace_id <> NEW.workspace_id)
  OR EXISTS (SELECT 1 FROM node WHERE id = NEW.target_node_id AND workspace_id <> NEW.workspace_id)
  OR EXISTS (SELECT 1 FROM relation_type WHERE id = NEW.relation_type_id AND workspace_id <> NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'nodal: les extrémités et le type d''une relation doivent appartenir au même espace');
END;

CREATE TRIGGER node_tag_same_workspace_insert
BEFORE INSERT ON node_tag
WHEN (SELECT workspace_id FROM node WHERE id = NEW.node_id)
  <> (SELECT workspace_id FROM tag WHERE id = NEW.tag_id)
BEGIN
  SELECT RAISE(ABORT, 'nodal: le tag doit appartenir au même espace que le nœud');
END;

CREATE TRIGGER node_tag_same_workspace_update
BEFORE UPDATE ON node_tag
WHEN (SELECT workspace_id FROM node WHERE id = NEW.node_id)
  <> (SELECT workspace_id FROM tag WHERE id = NEW.tag_id)
BEGIN
  SELECT RAISE(ABORT, 'nodal: le tag doit appartenir au même espace que le nœud');
END;
`,
};
