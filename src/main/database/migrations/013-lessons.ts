import type { Migration } from '../migrations';

/**
 * Mémoire de travail : leçons notées par un assistant.
 *
 * - `lesson` : question, issue (utile, impasse, corrigé) et précision.
 * - `lesson_node` : nœuds consultés, avec l'empreinte de leurs fichiers ancrés
 *   à ce moment (JSON `dossier/chemin` → empreinte ; `NULL` : pas de code, ou
 *   trop de fichiers). Un nœud supprimé quitte la leçon, qui reste.
 * - `assistant_change` accepte l'action `lesson` (reconstruite, comme en 012).
 */
export const migration013: Migration = {
  version: 13,
  name: 'lessons',
  sql: /* sql */ `
CREATE TABLE lesson (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL,
  client       TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('useful', 'dead_end', 'corrected')),
  question     TEXT NOT NULL CHECK (length(trim(question)) > 0),
  question_key TEXT NOT NULL,
  note         TEXT
) STRICT;
CREATE INDEX lesson_workspace_idx ON lesson (workspace_id, created_at);

CREATE TABLE lesson_node (
  lesson_id TEXT NOT NULL REFERENCES lesson (id) ON DELETE CASCADE,
  node_id   TEXT NOT NULL REFERENCES node (id) ON DELETE CASCADE,
  files     TEXT,
  PRIMARY KEY (lesson_id, node_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX lesson_node_node_idx ON lesson_node (node_id);

CREATE TABLE assistant_change_new (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL,
  client       TEXT,
  action       TEXT NOT NULL CHECK (action IN ('create_node', 'update_node', 'create_document', 'update_document', 'link', 'tag', 'anchor', 'review', 'lesson')),
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
