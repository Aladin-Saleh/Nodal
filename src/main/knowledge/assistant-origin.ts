/**
 * Provenance des éléments créés par un assistant IA (serveur MCP), lue dans
 * le journal `assistant_change`. Module sans dépendance vers les services
 * métier : ceux-ci l'utilisent, et le service du journal les utilise.
 */
import type { AssistantOrigin } from '../../shared/model';

/**
 * Sous-requête des créations faites par l'assistant, ni annulées ni
 * validées par l'utilisateur, à joindre sur `entity_id` : `client`,
 * `created_at`. Un élément validé est présenté comme saisi par l'utilisateur.
 */
export function assistantCreations(action: 'create_node' | 'link'): string {
  return `(SELECT entity_id, client, created_at FROM assistant_change
    WHERE action = '${action}' AND undone_at IS NULL AND validated_at IS NULL)`;
}

/** Identifiants des nœuds ajoutés par l'assistant et pas encore validés. */
export function pendingAssistantNodeIds(ctx: {
  db: { prepare(sql: string): { all(...params: string[]): unknown[] } };
  workspaceId: string;
}): Set<string> {
  return new Set(
    (
      ctx.db
        .prepare(
          `SELECT c.entity_id FROM ${assistantCreations('create_node')} c
           JOIN node n ON n.id = c.entity_id WHERE n.workspace_id = ?`,
        )
        .all(ctx.workspaceId) as { entity_id: string }[]
    ).map((row) => row.entity_id),
  );
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
