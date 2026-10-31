import type { Migration } from '../migrations';

/**
 * Lacunes de la base : recherches d'un assistant IA (serveur MCP) restées
 * sans résultat. Seuls la requête, ses dates et son nombre d'occurrences
 * sont gardés, regroupés par requête normalisée (`query_key` : sans accents
 * ni casse). `status` : à traiter (`open`), traitée (`done`, un nœud a été
 * créé) ou écartée (`ignored`).
 */
export const migration009: Migration = {
  version: 9,
  name: 'search-gaps',
  sql: /* sql */ `
CREATE TABLE search_gap (
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  query_key    TEXT NOT NULL,
  query        TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
  first_at     TEXT NOT NULL,
  last_at      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'ignored')),
  PRIMARY KEY (workspace_id, query_key)
) STRICT, WITHOUT ROWID;
`,
};
