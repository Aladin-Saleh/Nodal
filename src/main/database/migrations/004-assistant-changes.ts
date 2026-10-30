import type { Migration } from '../migrations';

/**
 * Journal des modifications faites par un assistant IA via le serveur MCP :
 * chaque écriture y est tracée avec l'état avant et après, pour pouvoir la
 * relire et l'annuler depuis l'application.
 *
 * Pas de clé étrangère vers les nœuds ou documents : une entrée reste
 * consultable après la suppression de l'élément qu'elle concerne.
 */
export const migration004: Migration = {
  version: 4,
  name: 'assistant-changes',
  sql: /* sql */ `
CREATE TABLE assistant_change (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  created_at   TEXT NOT NULL,
  client       TEXT,
  action       TEXT NOT NULL CHECK (action IN ('create_node', 'update_node', 'create_document', 'update_document', 'link', 'tag')),
  node_id      TEXT,
  entity_id    TEXT NOT NULL,
  summary      TEXT NOT NULL,
  before_json  TEXT,
  after_json   TEXT,
  undone_at    TEXT
) STRICT;
CREATE INDEX assistant_change_workspace_idx ON assistant_change (workspace_id, created_at);
`,
};
