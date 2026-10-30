import type { Migration } from '../migrations';

/**
 * Validation par l'utilisateur de ce qu'un assistant IA a ajouté : l'entrée
 * du journal est conservée (historique, annulation), seule la date de
 * validation est notée. Un élément validé n'est plus présenté comme « ajouté
 * par l'IA » (pastille, filtre, provenance renvoyée par le serveur MCP).
 */
export const migration005: Migration = {
  version: 5,
  name: 'assistant-validation',
  sql: /* sql */ `
ALTER TABLE assistant_change ADD COLUMN validated_at TEXT;
`,
};
