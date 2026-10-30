/**
 * Provenance des éléments créés par un assistant IA (serveur MCP), lue dans
 * le journal `assistant_change`. Module sans dépendance vers les services
 * métier : ceux-ci l'utilisent, et le service du journal les utilise.
 */
import type { AssistantOrigin } from '../../shared/model';

/**
 * Sous-requête des créations faites par l'assistant et non annulées, à
 * joindre sur `entity_id` : `client`, `created_at`.
 */
export function assistantCreations(action: 'create_node' | 'link'): string {
  return `(SELECT entity_id, client, created_at FROM assistant_change
    WHERE action = '${action}' AND undone_at IS NULL)`;
}

/** Provenance lue depuis les colonnes jointes `origin_at` / `origin_client`. */
export function toAssistantOrigin(row: {
  origin_at: string | null;
  origin_client: string | null;
}): AssistantOrigin | null {
  return row.origin_at
    ? { client: row.origin_client, createdAt: row.origin_at }
    : null;
}
