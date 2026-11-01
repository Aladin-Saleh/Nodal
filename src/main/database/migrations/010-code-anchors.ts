import type { Migration } from '../migrations';

/**
 * Ancrage des nœuds aux fichiers du code.
 *
 * - `node_anchor` : chemins ou motifs glob relatifs aux dossiers de code de
 *   l'espace (réglage `code.roots`, chemins locaux). Retirés avec le nœud.
 * - `node.code_reviewed_at` : « Marquer comme à jour » ; la date de
 *   référence d'un nœud ancré est la plus récente de sa mise à jour, de
 *   celles de ses documents et de cette date.
 * - `assistant_change` accepte l'action `anchor` (ancrage par un assistant
 *   via nodal_apply) : SQLite ne sait pas modifier un CHECK, la table est
 *   donc reconstruite à l'identique, données comprises.
 */
export const migration010: Migration = {
  version: 10,
  name: 'code-anchors',
  sql: /* sql */ `
CREATE TABLE node_anchor (
  node_id    TEXT NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  pattern    TEXT NOT NULL CHECK (length(trim(pattern)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (node_id, pattern)
) STRICT, WITHOUT ROWID;

ALTER TABLE node ADD COLUMN code_reviewed_at TEXT;

CREATE TABLE assistant_change_new (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL,
  client       TEXT,
  action       TEXT NOT NULL CHECK (action IN ('create_node', 'update_node', 'create_document', 'update_document', 'link', 'tag', 'anchor')),
  node_id      TEXT,
  entity_id    TEXT NOT NULL,
  summary      TEXT NOT NULL,
  before_json  TEXT,
  after_json   TEXT,
  undone_at    TEXT,
  validated_at TEXT
) STRICT;
INSERT INTO assistant_change_new
  (id, workspace_id, created_at, client, action, node_id, entity_id, summary, before_json, after_json, undone_at, validated_at)
SELECT id, workspace_id, created_at, client, action, node_id, entity_id, summary, before_json, after_json, undone_at, validated_at
FROM assistant_change ORDER BY rowid;
DROP TABLE assistant_change;
ALTER TABLE assistant_change_new RENAME TO assistant_change;
CREATE INDEX assistant_change_workspace_idx ON assistant_change (workspace_id, created_at);
`,
};
