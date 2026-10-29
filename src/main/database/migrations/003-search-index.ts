import type { Migration } from '../migrations';

/**
 * Index de recherche plein texte (§6.9) : titres et résumés des nœuds,
 * titres et contenus des documents (code compris). FTS5 avec suppression
 * des accents : « deploiement » trouve « déploiement ».
 *
 * L'index est tenu à jour par des triggers : aucun chemin d'écriture ne peut
 * l'oublier. Les colonnes d'identifiants ne sont pas indexées ; la mise à
 * jour d'une entrée parcourt donc la table, ce qui reste rapide à l'échelle
 * visée (quelques milliers de nœuds, §9).
 */
export const migration003: Migration = {
  version: 3,
  name: 'search-index',
  sql: /* sql */ `
CREATE VIRTUAL TABLE search_index USING fts5(
  kind UNINDEXED,
  item_id UNINDEXED,
  node_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO search_index (kind, item_id, node_id, title, body)
  SELECT 'node', id, id, title, COALESCE(summary, '') FROM node;
INSERT INTO search_index (kind, item_id, node_id, title, body)
  SELECT 'document', id, node_id, title, body FROM document;

CREATE TRIGGER search_node_insert AFTER INSERT ON node
BEGIN
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('node', NEW.id, NEW.id, NEW.title, COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER search_node_update AFTER UPDATE OF title, summary ON node
BEGIN
  DELETE FROM search_index WHERE kind = 'node' AND item_id = OLD.id;
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('node', NEW.id, NEW.id, NEW.title, COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER search_node_delete AFTER DELETE ON node
BEGIN
  DELETE FROM search_index WHERE kind = 'node' AND item_id = OLD.id;
END;

CREATE TRIGGER search_document_insert AFTER INSERT ON document
BEGIN
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('document', NEW.id, NEW.node_id, NEW.title, NEW.body);
END;

CREATE TRIGGER search_document_update AFTER UPDATE OF title, body, node_id ON document
BEGIN
  DELETE FROM search_index WHERE kind = 'document' AND item_id = OLD.id;
  INSERT INTO search_index (kind, item_id, node_id, title, body)
  VALUES ('document', NEW.id, NEW.node_id, NEW.title, NEW.body);
END;

CREATE TRIGGER search_document_delete AFTER DELETE ON document
BEGIN
  DELETE FROM search_index WHERE kind = 'document' AND item_id = OLD.id;
END;
`,
};
