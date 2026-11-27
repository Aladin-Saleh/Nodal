import type { Migration } from '../migrations';

/**
 * Vues graphe créées par un assistant (opération `view` de nodal_apply).
 *
 * - `assistant_change` accepte les actions `create_view` et `update_view`
 *   (reconstruite, comme en 014) : une vue créée ou modifiée par l'assistant
 *   se relit et s'annule depuis l'activité IA, comme le reste.
 */
export const migration015: Migration = {
  version: 15,
  name: 'assistant-views',
  sql: /* sql */ `
CREATE TABLE assistant_change_new (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL,
  client       TEXT,
  action       TEXT NOT NULL CHECK (action IN ('create_node', 'update_node', 'create_document', 'update_document', 'link', 'tag', 'anchor', 'review', 'lesson', 'evidence', 'create_view', 'update_view')),
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
