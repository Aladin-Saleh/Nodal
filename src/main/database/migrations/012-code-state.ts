import type { Migration } from '../migrations';

/**
 * Obsolescence par empreinte de contenu.
 *
 * - `node_code_state` : contenu du code que reflète la documentation d'un
 *   nœud ancré (empreinte par fichier, voir CodeSnapshot). Retiré avec le
 *   nœud ; reconstruit s'il manque, donc absent des exports.
 * - `assistant_change` accepte l'action `review` (fichiers déclarés relus par
 *   un assistant) : table reconstruite à l'identique, comme en 010.
 */
export const migration012: Migration = {
  version: 12,
  name: 'code-state',
  sql: /* sql */ `
CREATE TABLE node_code_state (
  node_id  TEXT PRIMARY KEY NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  since    TEXT NOT NULL,
  patterns TEXT NOT NULL,
  files    TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE assistant_change_new (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL,
  client       TEXT,
  action       TEXT NOT NULL CHECK (action IN ('create_node', 'update_node', 'create_document', 'update_document', 'link', 'tag', 'anchor', 'review')),
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
