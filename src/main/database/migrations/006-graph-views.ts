import type { Migration } from '../migrations';

/**
 * Vues graphe enregistrées (revient sur la décision V1 « une seule vue par
 * espace ») : une vue nommée garde portée, profondeur, filtres, masquages /
 * solo, replis (`settings`, même JSON que `view.graph`) et caméra.
 *
 * Table dédiée plutôt qu'une liste JSON dans workspace_settings : chaque vue
 * se crée, se renomme et se supprime seule (pas de réécriture d'un gros
 * JSON), le nom est unique par contrainte (sans casse) et la vue par défaut
 * est unique par index partiel.
 *
 * Les réglages actuels (`view.graph`) deviennent la vue « Par défaut ».
 * `view.graph` reste l'état de travail, enregistré au fil de l'eau.
 */
export const migration006: Migration = {
  version: 6,
  name: 'graph-views',
  sql: /* sql */ `
CREATE TABLE graph_view (
  id           TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE RESTRICT,
  name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
  settings     TEXT NOT NULL,
  camera       TEXT,
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX graph_view_name ON graph_view (workspace_id, name COLLATE NOCASE);
CREATE UNIQUE INDEX graph_view_default ON graph_view (workspace_id) WHERE is_default = 1;

INSERT INTO graph_view (id, workspace_id, name, settings, camera, is_default, sort_order, created_at, updated_at)
SELECT
  lower(substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12)),
  workspace_id, 'Par défaut', value, NULL, 1, 0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (SELECT hex(randomblob(16)) AS h, workspace_id, value
      FROM workspace_settings WHERE key = 'view.graph');
`,
};
