import type { Migration } from '../migrations';

/**
 * Suggestions de liens écartées (« Ignorer ») : le document du nœud source
 * cite le titre du nœud cible, mais l'utilisateur ne veut pas les relier.
 * Les suggestions elles-mêmes sont recalculées nœud par nœud, à l'affichage
 * et après chaque enregistrement : seuls les refus sont mémorisés. Retirés
 * avec l'un des deux nœuds (triggers : les clés étrangères de l'espace sont
 * en ON DELETE RESTRICT).
 */
export const migration008: Migration = {
  version: 8,
  name: 'link-suggestion-ignored',
  sql: /* sql */ `
CREATE TABLE link_suggestion_ignored (
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (source_node_id, target_node_id)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER link_suggestion_node_delete AFTER DELETE ON node
BEGIN
  DELETE FROM link_suggestion_ignored
  WHERE source_node_id = OLD.id OR target_node_id = OLD.id;
END;
`,
};
