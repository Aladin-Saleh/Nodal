import type { Migration } from '../migrations';

/**
 * Qualité.
 *
 * - `duplicate_ignored` : paires écartées (« pas un doublon »), la plus petite
 *   des deux clés d'abord ; retirées avec l'un des nœuds.
 * - `edge.confidence` : `certain`, `probable`, `uncertain` ; `NULL` : pas
 *   d'avis (relations antérieures, relations créées à la main).
 * - `edge_evidence` : preuves d'une relation, source et citation. `verified` :
 *   la citation a été retrouvée dans le fichier (1), non (0), ou n'a pas pu
 *   être vérifiée (`NULL`).
 * - `assistant_change` accepte l'action `evidence` (reconstruite, comme en 013).
 */
export const migration014: Migration = {
  version: 14,
  name: 'quality',
  sql: /* sql */ `
CREATE TABLE duplicate_ignored (
  first_node_id  TEXT NOT NULL,
  second_node_id TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (first_node_id, second_node_id),
  CHECK (first_node_id < second_node_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER duplicate_ignored_node_delete AFTER DELETE ON node
BEGIN
  DELETE FROM duplicate_ignored
  WHERE first_node_id = OLD.id OR second_node_id = OLD.id;
END;

ALTER TABLE edge ADD COLUMN confidence TEXT CHECK (confidence IN ('certain', 'probable', 'uncertain'));

CREATE TABLE edge_evidence (
  id         TEXT PRIMARY KEY NOT NULL,
  edge_id    TEXT NOT NULL REFERENCES edge (id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (length(trim(source)) > 0),
  quote      TEXT,
  verified   INTEGER CHECK (verified IN (0, 1)),
  client     TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX edge_evidence_edge_idx ON edge_evidence (edge_id);

CREATE TABLE assistant_change_new (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL,
  client       TEXT,
  action       TEXT NOT NULL CHECK (action IN ('create_node', 'update_node', 'create_document', 'update_document', 'link', 'tag', 'anchor', 'review', 'lesson', 'evidence')),
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
